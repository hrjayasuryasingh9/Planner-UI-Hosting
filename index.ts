
import { GoogleGenAI } from "@google/genai";
import factoryData from "./testbody(1).json" assert { type: "json" };
import { marked } from "marked";

const OPTIMIZATION_API_URL = "https://13.203.235.227/optimize";
const SIMULATION_API_URL = "https://13.203.235.227/generate-scenarios";

// Full JSON Data provided by user
let FACTORY_DATA = factoryData

const undoHistory: Record<string, any> = {};

// --- DOM ELEMENTS ---
const boardContainer = document.getElementById('board-container');
const chatStream = document.getElementById('chat-stream');
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn');
const btnOptimizeBuyers = document.getElementById('btn-optimize-buyers');
const btnOptimizeOrders = document.getElementById('btn-optimize-orders');
const btnOptimizeBoard = document.getElementById('btn-optimize-board');
const btnRunSimulations = document.getElementById('btn-run-simulations');

// Copilot UI Elements
const copilotSidebar = document.getElementById('copilot-sidebar');
const btnCloseCopilot = document.getElementById('btn-close-copilot');
const copilotTrigger = document.getElementById('copilot-trigger');

// --- COPILOT TOGGLE LOGIC ---

function toggleCopilot(show) {
    if (show) {
        copilotSidebar.classList.remove('collapsed');
        copilotTrigger.classList.remove('visible');
    } else {
        copilotSidebar.classList.add('collapsed');
        copilotTrigger.classList.add('visible');
    }
}

btnCloseCopilot.addEventListener('click', () => toggleCopilot(false));
copilotTrigger.addEventListener('click', () => toggleCopilot(true));

// --- INITIALIZATION ---
function initBoard() {
    boardContainer.innerHTML = ''; // Clear

    // Add Board Header Spacer
    const headerSpacer = document.createElement('div');
    headerSpacer.style.height = "60px";
    boardContainer.appendChild(headerSpacer);

    // Simple layout rendering
    FACTORY_DATA.factoryData.data.forEach(line => {
        // Skip lines with invalid SiteID if necessary, but for now render all in data based on previous logic
        if (line.lineCode === "0001" && (line as any).siteID === 0) return;

        const row = document.createElement('div');
        row.className = 'line-row';

        const header = document.createElement('div');
        header.className = 'line-header';
        header.innerHTML = `
        <div class="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Line</div>
        <span class="text-2xl font-bold text-slate-700">${line.lineCode}</span>
        <div class="mt-2 text-[10px] px-2 py-0.5 bg-slate-100 rounded-full text-slate-500">Active</div>
    `;
        row.appendChild(header);

        const contentArea = document.createElement('div');
        contentArea.style.position = 'relative';
        contentArea.style.flex = '1';
        contentArea.style.height = '100%';
        // Add hour markers (visual only)
        contentArea.innerHTML = `
        <div class="absolute top-0 bottom-0 left-[20%] border-l border-dashed border-slate-200"></div>
        <div class="absolute top-0 bottom-0 left-[40%] border-l border-dashed border-slate-200"></div>
        <div class="absolute top-0 bottom-0 left-[60%] border-l border-dashed border-slate-200"></div>
        <div class="absolute top-0 bottom-0 left-[80%] border-l border-dashed border-slate-200"></div>
    `;
        row.appendChild(contentArea);

        // Render Orders (Strips)
        if (line.ordersData && line.ordersData.length > 0) {
            line.ordersData.forEach(order => {
                const strip = document.createElement('div');
                strip.className = 'strip-block';

                const leftPos = (order as any).stripOffSetWithCell || 5;
                const widthVal = (order as any).stripDetails?.stripWidth || (order as any).stripWidth || 15;

                strip.style.left = `${leftPos}%`;
                strip.style.width = `${widthVal}%`;
                strip.style.minWidth = '140px';

                strip.style.backgroundColor = (order as any).stripDetails?.cssStyles?.bgColour || '#f1f5f9';
                strip.style.borderColor = (order as any).stripDetails?.cssStyles?.border ? (order as any).stripDetails.cssStyles.border.split(' ')[2] : '#cbd5e1';

                strip.innerHTML = `
          <div>
            <div class="strip-header">
              <span>${order.orderDetails.ocDetails.buyerShortName || 'Unassigned'}</span>
              <span class="text-[9px] bg-white/80 px-1.5 py-0.5 rounded border border-black/5 text-slate-500 font-mono">#${order.stripId}</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-1 truncate font-medium">${order.orderDetails.ocDetails.orderReferenceNumber || 'Ref: N/A'}</div>
          </div>
          <div class="strip-meta flex justify-between items-end border-t border-black/5 pt-2 mt-1">
              <span class="font-semibold text-slate-600">${order.quantity} <span class="font-normal text-slate-400 text-[9px]">PCS</span></span>
              ${order.orderDetails.ocDetails.picFileName ? `<img src="${order.orderDetails.ocDetails.picFileName}" class="w-6 h-6 rounded-full border-2 border-white shadow-sm object-cover bg-slate-200">` : ''}
          </div>
        `;

                strip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleCopilot(true);
                    appendUserMessage(`Tell me details about order #${order.stripId}`);
                    callOptimizationApi(`Provide detailed analysis for Order #${order.stripId} on Line ${line.lineCode}.`, 'custom');
                });

                contentArea.appendChild(strip);
            });
        }

        boardContainer.appendChild(row);
    });
}

// --- CHAT UTILS ---

function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = text;
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
}

async function appendAIMessage(htmlContent) {
    const div = document.createElement('div');
    div.className = 'msg-ai';
    // Use Marked to parse Markdown
    div.innerHTML = await marked.parse(htmlContent);
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
}

function showThinking() {
    const id = 'thinking-' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg-ai typing-indicator';
    div.id = id;
    div.innerHTML = '<span></span><span></span><span></span>';
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
    return id;
}

function removeThinking(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// --- EXTERNAL API INTEGRATION ---

async function callOptimizationApi(query, type) {
    const thinkingId = showThinking();

    // Construct Payload per requirement
    const payload = {
        factoryData: FACTORY_DATA.factoryData,
        gridData: FACTORY_DATA.gridData,
        userMessage: query,
        status: null,
        message: null,
        timestamp: null
    };

    try {
        const response = await fetch(OPTIMIZATION_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        removeThinking(thinkingId);
        processApiResponse(data);

    } catch (error) {
        console.error("API Call Failed", error);
        removeThinking(thinkingId);
        appendAIMessage(`⚠️ <strong>Connection Error:</strong> Could not reach the optimization engine at ${OPTIMIZATION_API_URL}.<br>Please check your network connection.`);
    }
}

async function runSimulation() {
    const thinkingId = showThinking();

    const payload = {
        factoryData: FACTORY_DATA.factoryData,
        gridData: FACTORY_DATA.gridData,
        userMessage: "Run simulation",
        status: null,
        message: null,
        timestamp: null
    };

    try {
        const response = await fetch(SIMULATION_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        removeThinking(thinkingId);
        renderSimulationResponse(data);

    } catch (error) {
        console.error("Simulation API Failed", error);
        removeThinking(thinkingId);
        appendAIMessage("⚠️ Could not run simulations. Please check connection.");
    }
}

function processApiResponse(data) {
    // 1. Handle Proposals (stripJsonData)
    if (data.stripJsonData && data.stripJsonData.length > 0) {
        appendAIMessage(`I found <strong>${data.stripJsonData.length}</strong> optimization opportunities.`);
        data.stripJsonData.forEach(proposal => {
            renderProposalCard(proposal);
        });
        return;
    }

    // 2. Handle Drill-down Options (Buyers/Orders)
    let hasOptions = false;
    let optionsHtml = '<div class="mt-3 flex flex-col gap-2 h-full max-h-52 overflow-y-auto px-5">';

    if (data.availableBuyers && data.availableBuyers.length > 0) {
        hasOptions = true;
        appendAIMessage(data.message || "Which buyer would you like to optimize?");
        data.availableBuyers.forEach(buyer => {
            optionsHtml += `<button onclick="window.triggerOption('${buyer}', 'buyers')" class="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-full text-xs font-medium hover:bg-blue-50 transition shadow-sm">${buyer}</button>`;
        });
    } else if (data.availableOrders && data.availableOrders.length > 0) {
        hasOptions = true;
        appendAIMessage(data.message || "Which order needs attention?");
        data.availableOrders.forEach(order => {
            optionsHtml += `<button onclick="window.triggerOption('${order}', 'orders')" class="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-full text-xs font-medium hover:bg-blue-50 transition shadow-sm">#${order}</button>`;
        });
    }

    optionsHtml += '</div>';

    if (hasOptions) {
        const div = document.createElement('div');
        div.className = 'msg-ai bg-transparent !p-0 shadow-none';
        div.innerHTML = optionsHtml;
        chatStream.appendChild(div);
        chatStream.scrollTop = chatStream.scrollHeight;
    } else {
        // 3. Fallback / Simple Message
        appendAIMessage(data.message || "I analyzed the board but found no specific actions required at this moment.");
    }
}

function renderSimulationResponse(data) {
    appendAIMessage(`I've generated <strong>${data.scenarios.length}</strong> simulation scenarios based on current data.`);

    if (data.recommendation) {
        appendAIMessage(`💡 <strong>Recommendation:</strong> ${data.recommendation.reasoning}`);
    }

    data.scenarios.forEach(scenario => {
        const isRecommended = data.recommendation && data.recommendation.scenario === scenario.name;
        renderScenarioCard(scenario, isRecommended);
    });
}

function renderScenarioCard(scenario, isRecommended) {
    const id = `scen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const borderColor = isRecommended ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200';
    const bgHeader = isRecommended ? 'bg-emerald-50/50' : 'bg-white';
    const badge = isRecommended ? '<span class="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500 text-white ml-2">Recommended</span>' : '';

    const cardHTML = `
        <div class="proposal-card bg-white rounded-xl border ${borderColor} shadow-sm mb-3 hover:shadow-md transition-shadow" id="${id}">
            <div class="p-4 ${bgHeader} rounded-t-xl border-b border-slate-100">
                <div class="flex justify-between items-center mb-1">
                    <h3 class="text-sm font-bold text-slate-800 m-0">${scenario.name} ${badge}</h3>
                </div>
                <p class="text-xs text-slate-500 m-0">${scenario.expectedOutcome}</p>
            </div>
            <div class="p-4">
                <div class="text-xs text-slate-600 space-y-2">
                   ${scenario.operations.map((op, i) => `
                        <div class="flex gap-2 items-start">
                            <span class="text-slate-300 font-mono select-none">${i + 1}.</span>
                            <div>
                                <span class="font-medium text-slate-700">${op.actionType.replace(/_/g, ' ')}</span>
                                <span class="text-slate-400">Order #${op.stripId}</span>
                            </div>
                        </div>
                   `).join('')}
                </div>
                <div id="${id}-actions" class="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button onclick="window.applyScenario('${id}')" class="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition shadow-sm">
                        Apply Scenario
                    </button>
                </div>
            </div>
             <!-- Hidden data storage -->
            <textarea id="${id}-data" class="hidden">${JSON.stringify(scenario)}</textarea>
        </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = cardHTML;
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
}

function renderProposalCard(proposal) {
    const id = `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let badgeColor = "bg-blue-100 text-blue-700";
    let actionName = "Optimization";

    if (proposal.actionType) {
        if (proposal.actionType.includes('move')) {
            actionName = "Move Order";
            badgeColor = "bg-emerald-100 text-emerald-700";
        } else if (proposal.actionType.includes('split')) {
            actionName = "Split Order";
            badgeColor = "bg-purple-100 text-purple-700";
        }
    }

    const fullText = proposal.reasoning;

    const cardHTML = `
        <div class="proposal-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-3 hover:shadow-md transition-shadow" id="${id}">

            <div class="flex justify-between items-start mb-2">
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${badgeColor}">${actionName}</span>
                <span class="text-xs font-mono text-slate-400">#${proposal.stripId}</span>
            </div>

            <!-- REASONING BLOCK -->
            <div class="text-sm text-slate-700 leading-relaxed mb-3">
                <div id="${id}-reasoning" class="line-clamp-2">
                    ${fullText}
                </div>

                ${fullText.length > 120
            ? `<button id="${id}-toggle" 
                        class="text-blue-600 text-xs font-medium mt-1 hover:underline">
                        More
                   </button>`
            : ""}
            </div>

            <div id="${id}-actions" class="flex gap-2 mt-2 border-t border-slate-100 pt-3">
                <button onclick="window.applyProposal('${id}')" 
                    class="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition shadow-sm flex justify-center items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3">
                        <path fill-rule="evenodd"
                            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                            clip-rule="evenodd" />
                    </svg>
                    Apply
                </button>

                <button onclick="document.getElementById('${id}').remove()" 
                    class="px-3 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-lg text-xs font-medium">
                    Dismiss
                </button>
            </div>

            <textarea id="${id}-data" class="hidden">${JSON.stringify(proposal)}</textarea>
        </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = cardHTML;
    chatStream.appendChild(div);

    // FIXED TOGGLE LOGIC
    const toggleBtn = document.getElementById(`${id}-toggle`);
    if (toggleBtn) {
        const reasoningEl = document.getElementById(`${id}-reasoning`);

        toggleBtn.addEventListener("click", () => {
            const isCollapsed = reasoningEl.classList.contains("line-clamp-2");

            if (isCollapsed) {
                reasoningEl.classList.remove("line-clamp-2");
                toggleBtn.innerText = "Less";
            } else {
                reasoningEl.classList.add("line-clamp-2");
                toggleBtn.innerText = "More";
            }

            chatStream.scrollTop = chatStream.scrollHeight;
        });
    }

    chatStream.scrollTop = chatStream.scrollHeight;
}



// --- STATE MANAGEMENT (Global Scope for HTML access) ---

(window as any).triggerOption = (value, type) => {
    // Hardcoded query construction based on prompt requirements
    let query = "";
    if (type === 'buyers') query = `Optimize for buyer ${value}`;
    if (type === 'orders') query = `Optimize order #${value}`;

    appendUserMessage(value);
    callOptimizationApi(query, type);
};

(window as any).applyScenario = (cardId) => {
    const dataElem = document.getElementById(`${cardId}-data`) as HTMLTextAreaElement;
    if (!dataElem) return;

    const scenario = JSON.parse(dataElem.value);

    // 1. Save state for Undo (Full scenario undo)
    undoHistory[cardId] = JSON.parse(JSON.stringify(FACTORY_DATA));

    // 2. Apply all operations
    scenario.operations.forEach(op => {
        // Map simulation JSON fields to updateBoardState expected fields
        const mappedOp = {
            ...op,
            // split_child in simulation JSON uses 'lineId', updateBoardState expects 'newLineId'
            newLineId: op.lineId,
            newStartDate: op.startDate,
            newQuantity: op.newQuantity || op.quantity // Handle variance
        };
        updateBoardState(mappedOp, false); // Pass false to skip initBoard
    });

    initBoard(); // Render once at end

    // 3. Update Visual Card State
    const actionsDiv = document.getElementById(`${cardId}-actions`);
    if (actionsDiv) {
        actionsDiv.innerHTML = `
            <div class="flex items-center justify-between w-full bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                <div class="flex items-center gap-2 text-emerald-700">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                    </svg>
                    <span class="text-sm font-semibold">Applied</span>
                </div>
                <button onclick="window.undoProposal('${cardId}')" class="text-xs bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-100 px-3 py-1 rounded shadow-sm font-medium transition flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                    Undo
                </button>
            </div>
        `;
    }
};

(window as any).applyProposal = (cardId) => {
    const dataElem = document.getElementById(`${cardId}-data`) as HTMLTextAreaElement;
    if (!dataElem) return;

    const proposal = JSON.parse(dataElem.value);

    // 1. Save state for Undo
    undoHistory[cardId] = JSON.parse(JSON.stringify(FACTORY_DATA));

    // 2. Update Board Data
    updateBoardState(proposal);

    // 3. Update Visual Card State with Undo button
    const actionsDiv = document.getElementById(`${cardId}-actions`);
    if (actionsDiv) {
        actionsDiv.innerHTML = `
            <div class="flex items-center justify-between w-full bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                <div class="flex items-center gap-2 text-emerald-700">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                    </svg>
                    <span class="text-sm font-semibold">Applied</span>
                </div>
                <button onclick="window.undoProposal('${cardId}')" class="text-xs bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-100 px-3 py-1 rounded shadow-sm font-medium transition flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                    Undo
                </button>
            </div>
        `;
    }
};

(window as any).undoProposal = (cardId) => {
    if (!undoHistory[cardId]) return;

    // 1. Restore State
    FACTORY_DATA = JSON.parse(JSON.stringify(undoHistory[cardId]));

    // 2. Re-render Board
    initBoard();

    // 3. Revert UI to Apply button
    // Note: If it was a scenario card, we need to render the scenario button, otherwise proposal button.
    // Since cardId is unique, we can check the element content or just simple logic.
    // For simplicity, we'll check the ID prefix.
    const isScenario = cardId.startsWith('scen-');

    const actionsDiv = document.getElementById(`${cardId}-actions`);
    if (actionsDiv) {
        if (isScenario) {
            actionsDiv.innerHTML = `
                <button onclick="window.applyScenario('${cardId}')" class="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition shadow-sm">
                    Apply Scenario
                </button>
             `;
        } else {
            actionsDiv.innerHTML = `
                <button onclick="window.applyProposal('${cardId}')" class="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition shadow-sm flex justify-center items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Apply
                </button>
                <button onclick="document.getElementById('${cardId}').remove()" class="px-3 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-lg text-xs font-medium">Dismiss</button>
            `;
        }
    }
};

function updateBoardState(proposal, shouldRender = true) {
    // Logic to update FACTORY_DATA based on the actionType

    // Helper to update or move existing strip
    if (proposal.actionType !== 'split_child') {
        // Find the strip in the data
        let foundLine = null;
        let foundOrderIdx = -1;
        let foundOrder = null;

        FACTORY_DATA.factoryData.data.forEach(line => {
            const idx = line.ordersData.findIndex(o => o.stripId == proposal.stripId);
            if (idx !== -1) {
                foundLine = line;
                foundOrderIdx = idx;
                foundOrder = line.ordersData[idx];
            }
        });

        if (foundOrder) {
            if (proposal.actionType === 'move_along_line' || proposal.actionType === 'move_across_lines') {
                // Update dates
                if (proposal.startDateFrom) foundOrder.startDate = proposal.startDateFrom;
                if (proposal.startDateTo) foundOrder.endDate = proposal.startDateTo;

                // Visual shift (mocked since we don't have date-to-pixel calculator in frontend)
                // We shift it slightly to right or left based on action description
                foundOrder.stripOffSetWithCell = (foundOrder.stripOffSetWithCell || 10) + (Math.random() > 0.5 ? 5 : -5);

                // If moving across lines
                if (proposal.lineIdTo && proposal.lineIdTo != foundLine.lineId) {
                    foundLine.ordersData.splice(foundOrderIdx, 1); // Remove from old
                    const newLine = FACTORY_DATA.factoryData.data.find(l => l.lineId == proposal.lineIdTo);
                    if (newLine) newLine.ordersData.push(foundOrder);
                }
            } else if (proposal.actionType === 'split_parent') {
                // Update quantity
                if (proposal.quantityTo) {
                    foundOrder.quantity = proposal.quantityTo;
                    // Also update the order details internal quantity to ensure the card renders "PCS" correctly
                    if (foundOrder.orderDetails) {
                        foundOrder.orderDetails.quantity = proposal.quantityTo;
                        if (foundOrder.orderDetails.ocDetails) {
                            foundOrder.orderDetails.ocDetails.units = proposal.quantityTo;
                        }
                    }
                }

                // Update width proportional to quantity reduction (simple visual hack)
                if (!foundOrder.stripDetails) {
                    foundOrder.stripDetails = { stripWidth: 20 }; // Default safety
                }
                if (foundOrder.stripDetails) {
                    foundOrder.stripDetails.stripWidth = (foundOrder.stripDetails.stripWidth || 20) * 0.6;
                }

                // If moving parent to new line? (Logic in JSON says split_parent has lineIdTo)
                if (proposal.lineIdTo && proposal.lineIdTo != foundLine.lineId) {
                    foundLine.ordersData.splice(foundOrderIdx, 1);
                    const newLine = FACTORY_DATA.factoryData.data.find(l => l.lineId == proposal.lineIdTo);
                    if (newLine) newLine.ordersData.push(foundOrder);
                }
            }
        }
    }

    // Helper to create new strip (Child)
    if (proposal.actionType === 'split_child') {
        const targetLineId = proposal.newLineId;
        const targetLine = FACTORY_DATA.factoryData.data.find(l => l.lineId == targetLineId);

        if (targetLine) {
            // Create a new strip object based on parent info or dummy info
            const newStripId = -Math.floor(Math.random() * 1000); // Temp ID
            const newStrip = {
                "stripId": newStripId,
                "startDate": proposal.newStartDate,
                "endDate": "2025-02-02T08:00:00", // Estimated
                "quantity": proposal.newQuantity,
                "stripOffSetWithCell": 35, // Arbitrary for visual
                "stripDetails": {
                    "stripWidth": 10,
                    "cssStyles": { "bgColour": "#dcfce7", "border": "1px solid #86efac" }
                },
                "orderDetails": {
                    "quantity": proposal.newQuantity,
                    "ocDetails": {
                        "buyerShortName": "SPLIT-CHILD",
                        "orderReferenceNumber": `Child of #${proposal.parentStripId || '?'}`,
                        "picFileName": "",
                        "units": proposal.newQuantity
                    }
                }
            };
            (targetLine.ordersData as any[]).push(newStrip);
        }
    }

    // 3. Re-render
    if (shouldRender) initBoard();
}


// --- GEMINI FALLBACK (General Chat) ---



// --- EVENT HANDLERS ---

async function handleAction(type) {
    toggleCopilot(true);

    let prompt = "";
    let label = "";

    // Hardcoded queries as requested
    switch (type) {
        case 'buyers':
            label = "Optimize Buyers";
            prompt = "Optimize Buyers";
            break;
        case 'orders':
            label = "Optimize Orders";
            prompt = "optimize orders";
            break;
        case 'board':
            label = "Optimize Board";
            prompt = "optimize board";
            break;
        case 'simulate':
            label = "Run Simulations";
            prompt = "Run a simulation: What happens if Line 0001 has a machine breakdown tomorrow for 4 hours?";
            break;
    }

    appendUserMessage(label);

    if (type === 'simulate') {
        runSimulation();
    } else {
        callOptimizationApi(prompt, type);
    }
}

// Button Listeners
btnOptimizeBuyers.addEventListener('click', () => handleAction('buyers'));
btnOptimizeOrders.addEventListener('click', () => handleAction('orders'));
btnOptimizeBoard.addEventListener('click', () => handleAction('board'));
btnRunSimulations.addEventListener('click', () => handleAction('simulate'));

// Chat Input Listener
sendBtn.addEventListener('click', async () => {
    const text = userInput.value;
    if (!text) return;

    appendUserMessage(text);
    userInput.value = '';

    // General chat goes to Gemini
    await callOptimizationApi(text, 'general');
});

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// Init
initBoard();
