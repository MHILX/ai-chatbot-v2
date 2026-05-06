const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const messages = document.querySelector("#messages");
const statusText = document.querySelector("#statusText");
const specDetails = document.querySelector("#specDetails");
const missingFields = document.querySelector("#missingFields");
const conversationIdBadge = document.querySelector("#conversationIdBadge");
const newConversationButton = document.querySelector("#newConversationButton");

const conversationKey = "app-builder-chatbot-conversation-id";
const userId = "local-user";
let conversationId = localStorage.getItem(conversationKey) || createConversationId();

localStorage.setItem(conversationKey, conversationId);
conversationIdBadge.textContent = shortId(conversationId);
renderSpec({});
renderMissing([]);
addMessage("assistant", "Tell me what kind of app you want to build.");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    return;
  }

  addMessage("user", text);
  input.value = "";
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
    addMessage("assistant", result.message);
    statusText.textContent = formatStatus(result.status);
    renderSpec(result.appSpec || {});
    renderMissing(result.missingFields || []);
  } catch {
    addMessage("assistant", "I could not process that message. Check the server logs and try again.");
  } finally {
    setLoading(false);
    input.focus();
  }
});

newConversationButton.addEventListener("click", () => {
  conversationId = createConversationId();
  localStorage.setItem(conversationKey, conversationId);
  conversationIdBadge.textContent = shortId(conversationId);
  messages.replaceChildren();
  statusText.textContent = "Collecting requirements";
  renderSpec({});
  renderMissing([]);
  addMessage("assistant", "Tell me what kind of app you want to build.");
  input.focus();
});

function createConversationId() {
  return `conv_${crypto.randomUUID()}`;
}

function shortId(id) {
  return id.replace("conv_", "").slice(0, 8);
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  input.disabled = isLoading;
}

function addMessage(role, content) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = content;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function renderSpec(spec) {
  const rows = [
    ["Name", spec.appName],
    ["Purpose", spec.purpose],
    ["Type", spec.appType],
    ["Users", spec.targetUsers],
    ["Features", spec.coreFeatures],
    ["Entities", spec.dataEntities],
    ["Integrations", spec.integrations],
    ["Auth", formatBoolean(spec.authRequired)]
  ];

  specDetails.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = formatValue(value);
      return [term, description];
    })
  );
}

function renderMissing(fields) {
  if (fields.length === 0) {
    const item = document.createElement("li");
    item.textContent = "None";
    missingFields.replaceChildren(item);
    return;
  }

  missingFields.replaceChildren(
    ...fields.map((field) => {
      const item = document.createElement("li");
      item.textContent = splitCamelCase(field);
      return item;
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

function formatStatus(status) {
  return splitCamelCase(String(status || "collecting_requirements").replaceAll("_", " "));
}

function splitCamelCase(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
