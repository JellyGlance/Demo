const DISCORD_LIMIT = 4096;
// JellyGlance Bot branding, shared by every Discord embed.
const BRAND_RED = 0xc90000; // brand / alerts / failures
const CHARCOAL = 0x1e1e1e; // neutral accent (info, updates, dependency bots)
const SUCCESS_GREEN = 0x2ecc71;
const WARN_AMBER = 0xf0b429;
const ISSUE_BLUE = 0x5b9cff;
// Shared with the main JellyGlance repository so every repo posts the same way.
const REPO = process.env.GITHUB_REPOSITORY || "JellyGlance/Documentation";
const REPO_URL = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${REPO}`;
// Short name shown in footers, e.g. "Docs" or "Demo".
const REPO_LABEL = process.env.DISCORD_REPO_LABEL || REPO.split("/").pop();
const LOGO_URL =
  "https://raw.githubusercontent.com/Nerdy-Technician/JellyGlance/main/.github/assets/icon-b-192.png";

/** Webhook identity: "JellyGlance Bot" or one of its sub-bots, always with the logo. */
function botIdentity(name = "JellyGlance Bot") {
  return { username: name, avatar_url: LOGO_URL };
}

/** Consistent footer on every embed. */
function brandFooter(extra = "") {
  return {
    text: extra ? `JellyGlance Bot · ${REPO_LABEL} · ${extra}` : `JellyGlance Bot · ${REPO_LABEL}`,
    icon_url: LOGO_URL,
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function trimDescription(value, limit = DISCORD_LIMIT) {
  if (!value || value.length <= limit) return value || "";
  return `${value.slice(0, limit - 28).trim()}\n\n…read more on GitHub`;
}

/** Light cleanup so release notes read cleanly in Discord (plain text, not HTML). */
function stripToText(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\r\n/g, "\n");

  // Drop HTML comments until stable (avoids incomplete <!-- leftovers).
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/<!--[\s\S]*?-->/g, "");
    if (next === s) break;
    s = next;
  }

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<summary[^>]*>\s*<b>([\s\S]*?)<\/b>[^<]*/gi, "$1")
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "$1\n")
    .replace(/<details[^>]*>/gi, "")
    .replace(/<\/details>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<(?:ul|ol)[^>]*>/gi, "")
    .replace(/<\/(?:ul|ol)>/gi, "\n")
    .replace(/<blockquote[^>]*>/gi, "")
    .replace(/<\/blockquote>/gi, "\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2")
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "$2")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "$2")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<hr\s*\/?>/gi, "\n");

  // Strip remaining tags until stable, then remove leftover angle brackets
  // so incomplete fragments like "<script" cannot survive.
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[<>]/g, "");

  // Normalize a few safe entities only. Do NOT decode &amp; → & —
  // CodeQL flags that as double-unescape, and Discord is plain text anyway.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "")
    .replace(/&gt;/gi, "")
    .replace(/&amp;/gi, " and ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\|[^\n]*\|/g, "")
    .replace(/^[\t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

async function postDiscord(webhookUrl, rawPayload) {
  const payload = {
    ...botIdentity(),
    ...rawPayload,
    // Embeds may contain @names from GitHub; never turn them into Discord pings.
    allowed_mentions: { parse: [] },
  };
  if (process.env.DISCORD_DRY_RUN === "1") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed with ${response.status}: ${text}`);
  }
}

async function sendIssue() {
  const webhook = process.env.DISCORD_DRY_RUN === "1" ? "" : requireEnv("DISCORD_WEBHOOK_URL");
  const title = optionalEnv("ISSUE_TITLE", "New issue");
  const url = optionalEnv("ISSUE_URL", "");
  const number = optionalEnv("ISSUE_NUMBER", "");
  const action = optionalEnv("ISSUE_ACTION", "opened");
  const stateReason = optionalEnv("ISSUE_STATE_REASON", "");
  const actor = optionalEnv("ISSUE_ACTOR", "");
  const rawAuthor = optionalEnv("ISSUE_AUTHOR", "someone");
  const author = rawAuthor.replace(/\[bot\]$/, "");
  const authorUrl = optionalEnv("ISSUE_AUTHOR_URL", `https://github.com/${author}`);
  const authorAvatar = optionalEnv(
    "ISSUE_AUTHOR_AVATAR",
    `https://github.com/${author}.png?size=128`,
  );
  const labelsRaw = optionalEnv("ISSUE_LABELS", "");
  const body = optionalEnv("ISSUE_BODY", "").trim();

  const labels = labelsRaw
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const labelText = labels.length
    ? labels.map((label) => `\`${label}\``).join(" ")
    : "_none_";
  const isSecurityAlert = labels.includes("security-alert");

  // Alert issues start with their own heading; the embed already has one.
  const text = isSecurityAlert ? stripToText(body).replace(/^#{1,6}\s.*\n*/, "") : stripToText(body);
  const excerpt = trimDescription(text || "No description provided.", isSecurityAlert ? 700 : 1200);

  let heading = "🐛 New issue";
  let color = ISSUE_BLUE;
  let description = excerpt;
  if (isSecurityAlert) {
    heading = action === "closed" ? "✅ Security alert resolved" : "🚨 Security alert";
    color = action === "closed" ? SUCCESS_GREEN : BRAND_RED;
  } else if (action === "closed") {
    const notPlanned = stateReason === "not_planned";
    heading = notPlanned ? "🚫 Issue closed (not planned)" : "✅ Issue closed";
    color = notPlanned ? CHARCOAL : SUCCESS_GREEN;
    description = actor ? `Closed by [@${actor}](https://github.com/${actor}).` : "Issue closed.";
  } else if (action === "reopened") {
    heading = "🔁 Issue reopened";
    color = WARN_AMBER;
  }

  await postDiscord(webhook, {
    ...botIdentity(isSecurityAlert ? "JellyGlance Security Bot" : "JellyGlance Bot"),
    embeds: [
      {
        color,
        author: {
          name: `${heading} · @${author}`,
          url: authorUrl,
          icon_url: authorAvatar,
        },
        title: trimDescription(number ? `#${number} · ${title}` : title, 250),
        url: url || undefined,
        description,
        fields: [
          { name: "Author", value: `[@${author}](${authorUrl})`, inline: true },
          { name: "Labels", value: labelText, inline: true },
          ...(url
            ? [{ name: "Issue", value: `[Open on GitHub](${url})`, inline: false }]
            : []),
        ],
        footer: brandFooter(isSecurityAlert ? "Security alerts" : "Issues"),
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

function isDependencyBot(login, head) {
  return /renovate|dependabot|security-bot/i.test(login || "") || /^(renovate|dependabot)\//.test(head || "");
}

async function sendPullRequest() {
  const webhook = process.env.DISCORD_DRY_RUN === "1" ? "" : requireEnv("DISCORD_WEBHOOK_URL");
  const title = optionalEnv("PR_TITLE", "Pull request");
  const url = optionalEnv("PR_URL", "");
  const number = optionalEnv("PR_NUMBER", "");
  const author = optionalEnv("PR_AUTHOR", "someone");
  const authorAvatar = optionalEnv("PR_AUTHOR_AVATAR", `https://github.com/${author}.png?size=128`);
  const base = optionalEnv("PR_BASE", "main");
  const head = optionalEnv("PR_HEAD", "");
  const labels = optionalEnv("PR_LABELS", "");
  const body = stripToText(optionalEnv("PR_BODY", ""));
  const action = optionalEnv("PR_ACTION", "opened");
  const merged = optionalEnv("PR_MERGED", "") === "true";
  const mergedBy = optionalEnv("PR_MERGED_BY", "");
  const actor = optionalEnv("PR_ACTOR", "");
  const commits = optionalEnv("PR_COMMITS", "");
  const additions = optionalEnv("PR_ADDITIONS", "");
  const deletions = optionalEnv("PR_DELETIONS", "");
  const draft = optionalEnv("PR_DRAFT", "") === "true";
  const depBot = isDependencyBot(author, head);
  const authorLabel = author.replace(/\[bot\]$/, "");

  let status = "Opened";
  let emoji = depBot ? "📦" : "🆕";
  let color = depBot ? CHARCOAL : BRAND_RED;
  let description = trimDescription(body || "No description provided.", 700);

  if (action === "closed" && merged) {
    status = "Merged";
    emoji = "🎉";
    color = SUCCESS_GREEN;
    description = mergedBy
      ? `Merged into \`${base}\` by [@${mergedBy}](https://github.com/${mergedBy}).`
      : `Merged into \`${base}\`.`;
  } else if (action === "closed") {
    status = "Closed";
    emoji = "🚫";
    color = CHARCOAL;
    description = actor ? `Closed without merging by [@${actor}](https://github.com/${actor}).` : "Closed without merging.";
  } else if (action === "synchronize") {
    status = "Updated";
    emoji = "🔄";
    color = CHARCOAL;
    description = `New commits pushed to \`${head}\`.`;
  } else if (action === "reopened") {
    status = "Reopened";
    emoji = "🔁";
    color = WARN_AMBER;
  } else if (action === "ready_for_review") {
    status = "Ready for review";
    emoji = "👀";
  }
  if (draft && action !== "closed") status += " · draft";

  const fields = [
    { name: "Status", value: status, inline: true },
    { name: "Author", value: `[@${authorLabel}](https://github.com/${author.replace(/\[bot\]$/, "")})`, inline: true },
  ];
  if (commits || additions || deletions) {
    fields.push({
      name: "Size",
      value: `${commits ? `${commits} commit${commits === "1" ? "" : "s"} · ` : ""}+${additions || 0} / −${deletions || 0}`,
      inline: true,
    });
  }
  fields.push({ name: "Branch", value: `\`${head}\` → \`${base}\``, inline: false });
  fields.push({
    name: "Labels",
    value: labels
      ? labels
          .split(",")
          .map((l) => `\`${l.trim()}\``)
          .join(" ")
      : "_none_",
    inline: false,
  });

  await postDiscord(webhook, {
    ...botIdentity(depBot ? "JellyGlance Security Bot · Renovate" : "JellyGlance Bot"),
    embeds: [
      {
        color,
        author: { name: `${emoji} PR ${status.toLowerCase()} · @${authorLabel}`, icon_url: authorAvatar },
        title: trimDescription(`#${number} · ${title}`, 250),
        url: url || undefined,
        description,
        fields,
        footer: brandFooter(depBot ? "Dependency updates" : "Pull requests"),
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

/**
 * Workflow result: a deploy, a docs publish, or any workflow failing on main.
 * WORKFLOW_KIND: deploy | docs | failure
 */
async function sendWorkflow() {
  const webhook = process.env.DISCORD_DRY_RUN === "1" ? "" : requireEnv("DISCORD_WEBHOOK_URL");
  const kind = optionalEnv("WORKFLOW_KIND", "failure");
  const workflowName = optionalEnv("WORKFLOW_NAME", "Workflow");
  const workflowUrl = optionalEnv("WORKFLOW_URL", "");
  const conclusion = optionalEnv("CONCLUSION", "unknown");
  const branch = optionalEnv("BRANCH", "");
  const sha = (optionalEnv("SHA", "") || "").slice(0, 7);
  const trigger = optionalEnv("TRIGGER_EVENT", "unknown");
  const displayTitle = optionalEnv("DISPLAY_TITLE", "");
  const actor = optionalEnv("ACTOR", "");
  const prNumber = optionalEnv("PR_NUMBER", "");
  const prUrl = optionalEnv("PR_URL", "");
  const attempt = optionalEnv("RUN_ATTEMPT", "");

  const states = {
    success: { label: "Passed", emoji: "✅", color: SUCCESS_GREEN },
    failure: { label: "Failed", emoji: "❌", color: BRAND_RED },
    cancelled: { label: "Cancelled", emoji: "⏹️", color: WARN_AMBER },
    timed_out: { label: "Timed out", emoji: "⏱️", color: BRAND_RED },
    startup_failure: { label: "Startup failure", emoji: "💥", color: BRAND_RED },
  };
  const state = states[conclusion] || {
    label: conclusion.replace(/_/g, " ") || "Completed",
    emoji: "ℹ️",
    color: CHARCOAL,
  };

  const okWord = state.label.toLowerCase();
  const identity = {
    deploy: "JellyGlance Build Bot · Deploy",
    docs: "JellyGlance Docs Bot",
    failure: "JellyGlance Bot",
  }[kind] || "JellyGlance Bot";
  const checks = optionalEnv("WORKFLOW_CHECKS", "");
  const target = optionalEnv("DEPLOY_TARGET", "");
  const description = {
    deploy:
      conclusion === "success"
        ? `🚀 Deployed \`${sha || "the latest commit"}\` to the live ${REPO_LABEL.toLowerCase()}${target ? ` at ${target}` : ""}.`
        : `The ${REPO_LABEL.toLowerCase()} deploy ${okWord}. The live site keeps running the previous version until a deploy succeeds.`,
    docs:
      conclusion === "success"
        ? `📚 The documentation site was rebuilt and published${target ? ` at ${target}` : ""}.`
        : `The documentation build or publish ${okWord}. The live site keeps the previous version.`,
    failure: `**${workflowName}** ${okWord} on \`${branch || "main"}\`. This usually needs a look.`,
  }[kind] || `**${workflowName}** ${okWord}.`;

  const fields = [
    { name: "Status", value: `${state.emoji} ${state.label}`, inline: true },
    { name: "Trigger", value: trigger, inline: true },
    { name: "Branch", value: branch ? `\`${branch}\`` : "(unknown)", inline: true },
  ];
  if (sha) fields.push({ name: "Commit", value: `[\`${sha}\`](${REPO_URL}/commit/${optionalEnv("SHA", "")})`, inline: true });
  if (actor) fields.push({ name: "Actor", value: `[@${actor.replace(/\[bot\]$/, "")}](https://github.com/${actor.replace(/\[bot\]$/, "")})`, inline: true });
  if (attempt && attempt !== "1") fields.push({ name: "Attempt", value: attempt, inline: true });
  if (prNumber && prUrl) {
    fields.push({ name: "Pull request", value: `[#${prNumber}](${prUrl})`, inline: false });
  } else if (displayTitle) {
    fields.push({ name: "Run", value: trimDescription(displayTitle, 250), inline: false });
  }
  if (target) fields.push({ name: "Live", value: target, inline: false });
  if (checks) fields.push({ name: "Checks", value: checks, inline: false });
  fields.push({
    name: "Actions",
    value: workflowUrl ? `[View workflow run](${workflowUrl})` : "(no link)",
    inline: false,
  });

  await postDiscord(webhook, {
    ...botIdentity(identity),
    embeds: [
      {
        color: state.color,
        title: `${state.emoji} ${workflowName} · ${state.label}`,
        url: workflowUrl || undefined,
        description,
        fields,
        footer: brandFooter({ deploy: "Deploys", docs: "Docs publish" }[kind] || "Workflow alerts"),
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

async function sendSecurity() {
  const webhook = process.env.DISCORD_DRY_RUN === "1" ? "" : requireEnv("DISCORD_WEBHOOK_URL");
  const conclusion = optionalEnv("CONCLUSION", "unknown");
  const workflowUrl = optionalEnv("WORKFLOW_URL", "");
  const branch = optionalEnv("BRANCH", "");
  const sha = (optionalEnv("SHA", "") || "").slice(0, 7);
  const trigger = optionalEnv("TRIGGER_EVENT", "unknown");
  const displayTitle = optionalEnv("DISPLAY_TITLE", "Security");
  const summary = optionalEnv("SECURITY_SUMMARY", "");

  let statusLabel = "Completed";
  let color = CHARCOAL;
  let title = "🛡️ Security scan finished";

  if (conclusion === "failure") {
    statusLabel = "Findings / failed";
    color = BRAND_RED;
    title = "🚨 Security scan found issues";
  } else if (conclusion === "success") {
    statusLabel = "Clean";
    color = SUCCESS_GREEN;
    title = "✅ Security scan clean";
  } else if (conclusion === "cancelled") {
    statusLabel = "Cancelled";
    color = WARN_AMBER;
    title = "🛡️ Security scan cancelled";
  }

  const fields = [
    { name: "Status", value: statusLabel, inline: true },
    { name: "Trigger", value: trigger, inline: true },
    { name: "Branch", value: branch ? `\`${branch}\`` : "(unknown)", inline: true },
  ];
  if (sha) fields.push({ name: "Commit", value: `[\`${sha}\`](${REPO_URL}/commit/${optionalEnv("SHA", "")})`, inline: true });
  if (summary) {
    fields.push({ name: "Summary", value: summary.slice(0, 1000), inline: false });
  }
  if (workflowUrl) {
    fields.push({ name: "Run", value: `[Open workflow](${workflowUrl})`, inline: false });
  }
  fields.push({
    name: "Security tab",
    value: `[Code scanning / Dependabot](${REPO_URL}/security)`,
    inline: false,
  });

  await postDiscord(webhook, {
    ...botIdentity("JellyGlance Security Bot"),
    embeds: [
      {
        color,
        title,
        url: workflowUrl || undefined,
        description:
          conclusion === "failure"
            ? `${optionalEnv("WORKFLOW_NAME", "A security scan")} reported problems. Check the workflow run and the GitHub Security tab.`
            : displayTitle || "Security workflow finished.",
        fields,
        footer: brandFooter("Security"),
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

const type = requireEnv("DISCORD_EVENT_TYPE");

if (type === "issue") {
  await sendIssue();
} else if (type === "security") {
  await sendSecurity();
} else if (type === "pull_request") {
  await sendPullRequest();
} else if (type === "workflow") {
  await sendWorkflow();
} else {
  throw new Error(`Unsupported DISCORD_EVENT_TYPE: ${type}`);
}
