const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const sendButtonLabel = sendButton.querySelector("span");
const messages = document.querySelector("#messages");
const statusText = document.querySelector("#statusText");
const specDetails = document.querySelector("#specDetails");
const missingFields = document.querySelector("#missingFields");
const missingCount = document.querySelector("#missingCount");
const conversationIdBadge = document.querySelector("#conversationIdBadge");
const contextWindowBadge = document.querySelector("#contextWindowBadge");
const metricsSummary = document.querySelector("#metricsSummary");
const metricsUpdatedAt = document.querySelector("#metricsUpdatedAt");
const newConversationButton = document.querySelector("#newConversationButton");

const suggestionPrompts = [
  "An internal CRUD app for inventory tracking",
  "A customer-facing portal for support tickets",
  "A workflow approval app for expense reports",
  "A dashboard for sales pipeline analytics"
];

const specIcons = {
  appName: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/></svg>',
  purpose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
  appType: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h12"/></svg>',
  deploymentTarget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><circle cx="12" cy="9" r="3"/><path d="M3 21h18"/></svg>',
  targetUsers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  coreFeatures: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.4 5 5.6.8-4 3.9 1 5.5L12 14.8 6.9 17.2l1-5.5-4-3.9 5.6-.8z"/></svg>',
  dataEntities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  integrations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/></svg>',
  authRequired: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  workflowSteps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="m3 6 .8 .8L5.5 5"/><path d="m3 12 .8 .8 1.7-1.8"/><path d="m3 18 .8 .8 1.7-1.8"/></svg>'
};

const requiredFieldsByAppType = {
  crud: ["purpose", "targetUsers", "dataEntities", "coreFeatures"],
  dashboard: ["purpose", "targetUsers", "dataEntities", "coreFeatures"],
  workflow: ["purpose", "targetUsers", "coreFeatures", "workflowSteps"],
  chatbot: ["purpose", "targetUsers", "dataEntities"],
  portal: ["purpose", "targetUsers", "coreFeatures", "authRequired"],
  other: ["purpose", "targetUsers", "coreFeatures"]
};
const defaultRequiredFields = ["appType", "purpose"];
const conversationKey = "app-builder-chatbot-conversation-id";
const metricsRefreshIntervalMs = 5000;
const defaultContextWindowMaxTokens = 200000;
const defaultContextWindowWarningRatio = 0.8;
const defaultContextWindowBlockRatio = 0.95;
const userId = "local-user";
let conversationId = localStorage.getItem(conversationKey) || createConversationId();
let contextWindowMaxTokens = defaultContextWindowMaxTokens;
let contextWindowModelId = null;
let contextWindowWarningRatio = defaultContextWindowWarningRatio;
let contextWindowBlockRatio = defaultContextWindowBlockRatio;
let contextWindowStatus = "ok";
let runtimeMetadataAvailable = false;
let serverContextWindow = null;
let requestInFlight = false;
let currentStatus = "collecting_requirements";
let currentAppSpec = {};
let currentMissingFields = [];
let currentRequiredFields = [...defaultRequiredFields];

localStorage.setItem(conversationKey, conversationId);
conversationIdBadge.textContent = shortId(conversationId);
renderEmptyConversation();
loadRuntimeInfo();
loadConversation();
loadMetrics();
setInterval(loadMetrics, metricsRefreshIntervalMs);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCurrentMessage();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submitCurrentMessage();
  }
});

input.addEventListener("input", autoResizeTextarea);

async function submitCurrentMessage() {
  if (!canSendMessage()) {
    input.focus();
    return;
  }

  const text = input.value.trim();
  if (!text) {
    return;
  }

  serverContextWindow = null;
  addMessage("user", text);
  input.value = "";
  autoResizeTextarea();
  setLoading(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, userId, message: text })
    });

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const result = await response.json();
    renderConversationState(result);
    loadMetrics();
  } catch {
    setStatus("failed");
    addMessage("assistant", "I could not process that message. Check the server logs and try again.");
  } finally {
    setLoading(false);
    input.focus();
  }
}

function autoResizeTextarea() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

newConversationButton.addEventListener("click", () => {
  conversationId = createConversationId();
  localStorage.setItem(conversationKey, conversationId);
  conversationIdBadge.textContent = shortId(conversationId);
  renderEmptyConversation();
  input.focus();
});

function createConversationId() {
  return `conv_${crypto.randomUUID()}`;
}

async function loadMetrics() {
  try {
    const response = await fetch("/api/metrics");

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const metrics = await response.json();
    renderMetrics(metrics);
  } catch {
    renderMetricsUnavailable();
  }
}

async function loadRuntimeInfo() {
  try {
    const response = await fetch("/api/runtime");

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const runtime = await response.json();
    contextWindowMaxTokens = Number(runtime.contextWindowTokens);
    contextWindowWarningRatio = Number(runtime.contextWindowWarningRatio) || contextWindowWarningRatio;
    contextWindowBlockRatio = Number(runtime.contextWindowBlockRatio) || contextWindowBlockRatio;
    contextWindowModelId = runtime.modelId || null;
    runtimeMetadataAvailable = true;
    updateContextWindowBadge();
  } catch {
    contextWindowMaxTokens = defaultContextWindowMaxTokens;
    contextWindowWarningRatio = defaultContextWindowWarningRatio;
    contextWindowBlockRatio = defaultContextWindowBlockRatio;
    contextWindowModelId = null;
    runtimeMetadataAvailable = false;
    updateContextWindowBadge();
  }
}

async function loadConversation() {
  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const state = await response.json();
    renderConversationState(state);
  } catch {
    addMessage("assistant", "I could not reload the saved conversation. Start a new conversation if this looks out of date.");
  }
}

function renderConversationState(state) {
  conversationId = state.conversationId || conversationId;
  localStorage.setItem(conversationKey, conversationId);
  conversationIdBadge.textContent = shortId(conversationId);
  messages.replaceChildren();
  serverContextWindow = null;

  for (const message of state.messages || []) {
    addMessage(message.role, message.content);
  }

  setStatus(state.status);
  const appSpec = state.appSpec || {};
  renderSpec(appSpec, state.requiredFields);
  renderMissing(state.missingFields || []);
  renderContextWindow(state.contextWindow);
}

function renderEmptyConversation() {
  serverContextWindow = null;
  messages.replaceChildren();
  setStatus("collecting_requirements");
  renderSpec({}, defaultRequiredFields);
  renderMissing(null);
  renderEmptyState();
}

function renderEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  wrap.innerHTML = `
    <div class="empty-state-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
    <h2>Tell me what kind of app you want to build</h2>
    <p>Describe it in your own words, or pick a starting point below.</p>
    <div class="suggestion-chips" role="list"></div>
  `;
  const chipContainer = wrap.querySelector(".suggestion-chips");
  for (const prompt of suggestionPrompts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = prompt;
    chip.addEventListener("click", () => {
      input.value = prompt;
      autoResizeTextarea();
      input.focus();
      submitCurrentMessage();
    });
    chipContainer.appendChild(chip);
  }
  messages.appendChild(wrap);
}

function setStatus(status) {
  currentStatus = normalizeStatus(status);
  statusText.textContent = formatStatus(currentStatus);
  statusText.dataset.status = currentStatus;
  syncComposerState();
}

function renderContextWindow(contextWindow) {
  if (contextWindow) {
    serverContextWindow = contextWindow;
    contextWindowMaxTokens = Number(contextWindow.maxTokens) || contextWindowMaxTokens;
    runtimeMetadataAvailable = true;
  }

  updateContextWindowBadge();
}

function updateContextWindowBadge() {
  const contextWindow = getDisplayedContextWindow();
  contextWindowStatus = contextWindow.status;
  contextWindowBadge.textContent = `Ctx ~${formatTokenCount(contextWindow.usedTokens)} / ${formatTokenCount(contextWindow.maxTokens)}`;
  contextWindowBadge.title = buildContextWindowTitle(contextWindow);
  contextWindowBadge.classList.toggle("warning", contextWindow.status === "warning");
  contextWindowBadge.classList.toggle("blocked", contextWindow.status === "blocked");
  syncComposerState();
}

function getDisplayedContextWindow() {
  if (serverContextWindow) {
    return serverContextWindow;
  }

  const usedTokens = estimateContextUsageTokens();
  const maxTokens = Number(contextWindowMaxTokens);

  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return {
      usedTokens,
      maxTokens,
      usedRatio: 0,
      status: "ok"
    };
  }

  const usedRatio = usedTokens / maxTokens;
  const status = usedRatio >= contextWindowBlockRatio ? "blocked" : usedRatio >= contextWindowWarningRatio ? "warning" : "ok";

  return {
    usedTokens,
    maxTokens,
    usedRatio,
    status
  };
}

function buildContextWindowTitle(contextWindow) {
  const maxTokens = Number(contextWindow.maxTokens);
  const modelText = contextWindowModelId ? ` for ${contextWindowModelId}` : "";

  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return `Estimated context used${modelText}. Configured max is unavailable.`;
  }

  const percent = ((contextWindow.usedTokens / maxTokens) * 100).toFixed(2);
  const statusText = contextWindow.status === "blocked" ? " Context is full; new model calls are paused." : contextWindow.status === "warning" ? " Context is near the configured limit." : "";
  const metadataText = runtimeMetadataAvailable ? "" : " Runtime metadata is unavailable, so the UI is using the default local max; restart the server or use a port with /api/runtime for backend-enforced limits.";
  return `Estimated context used / configured window${modelText}: ${contextWindow.usedTokens} / ${maxTokens} tokens (${percent}%).${statusText}${metadataText} Actual provider token accounting may differ.`;
}

function estimateContextUsageTokens() {
  const messageContents = Array.from(messages.children).map((message) => message.textContent || "");
  const contextPayload = {
    status: statusText.textContent,
    messages: messageContents,
    appSpec: currentAppSpec,
    missingFields: currentMissingFields,
    requiredFields: currentRequiredFields
  };

  return estimateTokens(JSON.stringify(contextPayload));
}

function estimateTokens(text) {
  const characterCount = String(text || "").length;
  return Math.max(1, Math.ceil(characterCount / 4));
}

function formatTokenCount(value) {
  const tokens = Number(value);

  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "-";
  }

  if (tokens >= 1000000) {
    return `${formatCompactNumber(tokens / 1000000)}M`;
  }

  if (tokens >= 1000) {
    return `${formatCompactNumber(tokens / 1000)}K`;
  }

  return String(tokens);
}

function formatCompactNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shortId(id) {
  return id.replace("conv_", "").slice(0, 8);
}

function setLoading(isLoading) {
  requestInFlight = isLoading;
  syncComposerState();
}

function syncComposerState() {
  const disabled = requestInFlight || !canSendMessage();
  sendButton.disabled = disabled;
  sendButton.dataset.loading = requestInFlight ? "true" : "false";
  sendButton.setAttribute("aria-busy", requestInFlight ? "true" : "false");
  if (sendButtonLabel) {
    sendButtonLabel.textContent = requestInFlight ? "Waiting..." : "Send";
  }
  input.disabled = disabled;
}

function canSendMessage() {
  return contextWindowStatus !== "blocked" || currentStatus === "awaiting_confirmation";
}

function addMessage(role, content) {
  const emptyState = messages.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const node = document.createElement("div");
  node.className = `message ${role}`;

  if (role !== "system") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "user" ? "You" : "AB";
    node.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  node.appendChild(bubble);

  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  updateContextWindowBadge();
}

function renderSpec(spec, requiredFields = defaultRequiredFields) {
  currentAppSpec = spec;
  currentRequiredFields = resolveRequiredFields(spec, requiredFields);
  const requiredFieldSet = new Set(currentRequiredFields);
  const rows = [
    ["appName", "Name", spec.appName],
    ["purpose", "Purpose", spec.purpose],
    ["appType", "Type", spec.appType],
    ["deploymentTarget", "Platform", spec.deploymentTarget],
    ["targetUsers", "Users", spec.targetUsers],
    ["coreFeatures", "Features", spec.coreFeatures],
    ["dataEntities", "Entities", spec.dataEntities],
    ["workflowSteps", "Workflow", spec.workflowSteps],
    ["integrations", "Integrations", spec.integrations],
    ["authRequired", "Auth", formatBoolean(spec.authRequired)]
  ];

  specDetails.replaceChildren(
    ...rows.map(([key, label, value]) => {
      const empty = isEmptySpecValue(value);
      const isRequired = requiredFieldSet.has(key);
      const row = document.createElement("div");
      row.className = `spec-row ${empty ? "empty" : "filled"}${isRequired ? " required" : ""}`;

      const icon = document.createElement("span");
      icon.className = "spec-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = specIcons[key] || "";
      icon.querySelector("svg")?.setAttribute("width", "16");
      icon.querySelector("svg")?.setAttribute("height", "16");

      const term = document.createElement("dt");
      const labelText = document.createElement("span");
      labelText.textContent = label;
      term.appendChild(labelText);

      if (isRequired) {
        const marker = document.createElement("span");
        marker.className = "required-marker";
        marker.textContent = "*";
        marker.title = "Required for this app type";
        marker.setAttribute("aria-label", "required");
        term.appendChild(marker);
      }

      const description = document.createElement("dd");
      description.textContent = empty ? "Not set yet" : formatValue(value);

      row.append(icon, term, description);
      return row;
    })
  );
  updateContextWindowBadge();
}

function normalizeRequiredFields(fields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.filter((field) => typeof field === "string" && field.length > 0);
}

function resolveRequiredFields(spec, fields) {
  const resolved = new Set(defaultRequiredFields);

  for (const field of getRequiredFieldsForAppType(spec?.appType)) {
    resolved.add(field);
  }

  for (const field of normalizeRequiredFields(fields)) {
    resolved.add(field);
  }

  return [...resolved];
}

function getRequiredFieldsForAppType(appType) {
  const normalizedAppType = String(appType || "").trim().toLowerCase();
  return requiredFieldsByAppType[normalizedAppType] || [];
}

function renderMissing(fields) {
  currentMissingFields = fields ?? [];

  if (!fields) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "Not evaluated";
    missingFields.replaceChildren(item);
    if (missingCount) missingCount.textContent = "-";
    updateContextWindowBadge();
    return;
  }

  if (fields.length === 0) {
    const item = document.createElement("li");
    item.className = "complete";
    item.textContent = "All set";
    missingFields.replaceChildren(item);
    if (missingCount) missingCount.textContent = "0";
    updateContextWindowBadge();
    return;
  }

  missingFields.replaceChildren(
    ...fields.map((field) => {
      const item = document.createElement("li");
      item.textContent = splitCamelCase(field);
      return item;
    })
  );
  if (missingCount) missingCount.textContent = String(fields.length);
  updateContextWindowBadge();
}

function renderMetrics(metrics) {
  const turns = metrics.turns || {};
  const extractionFailures = metrics.extractionFailures || {};
  const confirmations = metrics.confirmations || {};
  const appCreation = metrics.appCreation || {};
  const privacy = metrics.privacy || {};
  const jailbreakResistance = metrics.jailbreakResistance || {};
  const contentSafety = metrics.contentSafety || {};
  const decisions = confirmations.decisions || {};

  metricsUpdatedAt.textContent = formatMetricsUpdatedAt(metrics.generatedAt);
  renderMetricRows([
    {
      label: "Turns",
      value: `${formatWholeNumber(turns.started)} started / ${formatWholeNumber(turns.completed)} done / ${formatWholeNumber(turns.failed)} failed`
    },
    {
      label: "Extraction",
      value: `${formatWholeNumber(extractionFailures.total)} failures`,
      title: `${formatWholeNumber(extractionFailures.requestFailures)} request, ${formatWholeNumber(extractionFailures.structuredOutputFailures)} JSON, ${formatWholeNumber(extractionFailures.repairFailures)} repair`
    },
    {
      label: "Confirm",
      value: `${formatWholeNumber(decisions.yes)} yes / ${formatWholeNumber(decisions.no)} no / ${formatWholeNumber(decisions.ambiguous)} unclear`,
      title: `${formatWholeNumber(confirmations.requested)} confirmation prompts requested`
    },
    {
      label: "Creation",
      value: `${formatWholeNumber(appCreation.success)} created / ${formatWholeNumber(appCreation.failure)} failed`
    },
    {
      label: "Guardrails",
      value: `${formatWholeNumber(privacy.redactions)} redacted / ${formatWholeNumber(jailbreakResistance.detected)} jailbreak / ${formatWholeNumber(contentSafety.blocked)} safety`,
      title: `${formatWholeNumber(jailbreakResistance.blocked)} jailbreak blocked, ${formatWholeNumber(jailbreakResistance.sanitized)} sanitized`
    },
    {
      label: "Turn Latency",
      value: formatLatencySummary(turns.latencyMs)
    },
    {
      label: "Build Latency",
      value: formatLatencySummary(appCreation.latencyMs)
    }
  ]);
}

function renderMetricsUnavailable() {
  metricsUpdatedAt.textContent = "Unavailable";
  renderMetricRows([
    { label: "Turns", value: "-" },
    { label: "Extraction", value: "-" },
    { label: "Confirm", value: "-" },
    { label: "Creation", value: "-" },
    { label: "Guardrails", value: "-" }
  ]);
}

function renderMetricRows(rows) {
  metricsSummary.replaceChildren(
    ...rows.map((row) => {
      const wrap = document.createElement("div");
      wrap.className = "metric-row";
      const term = document.createElement("dt");
      term.textContent = row.label;
      const description = document.createElement("dd");
      description.textContent = row.value;
      if (row.title) {
        description.title = row.title;
      }
      wrap.append(term, description);
      return wrap;
    })
  );
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function formatBoolean(value) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return null;
}

function formatWholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString() : "0";
}

function formatLatencySummary(summary) {
  if (!summary || !Number.isFinite(Number(summary.averageMs)) || Number(summary.count) === 0) {
    return "-";
  }

  return `${formatDurationMs(summary.averageMs)} avg`;
}

function formatDurationMs(value) {
  const milliseconds = Number(value);

  if (!Number.isFinite(milliseconds)) {
    return "-";
  }

  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }

  return `${Math.round(milliseconds)} ms`;
}

function formatMetricsUpdatedAt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Updated -";
  }

  return `Updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function formatStatus(status) {
  return splitCamelCase(normalizeStatus(status).replaceAll("_", " "));
}

function normalizeStatus(status) {
  return String(status || "collecting_requirements").trim().toLowerCase().replaceAll(" ", "_");
}

function isEmptySpecValue(value) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return value === null || value === undefined || value === "";
}

function splitCamelCase(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
