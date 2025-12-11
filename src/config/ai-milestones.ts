export interface AIMilestone {
  id: string;
  name: string;
  shortLabel: string;
  date: string; // ISO format YYYY-MM-DD
  type: "copilot" | "openai" | "anthropic" | "google" | "other";
  description: string;
  significance: "major" | "minor";
}

export const AI_MILESTONES: AIMilestone[] = [
  // 2022
  {
    id: "copilot-ga",
    name: "GitHub Copilot General Availability",
    shortLabel: "Copilot GA",
    date: "2022-06-21",
    type: "copilot",
    description: "GitHub Copilot became available to all developers",
    significance: "major",
  },
  {
    id: "chatgpt-launch",
    name: "ChatGPT Launch",
    shortLabel: "ChatGPT",
    date: "2022-11-30",
    type: "openai",
    description: "OpenAI released ChatGPT to the public",
    significance: "major",
  },

  // 2023
  {
    id: "gpt4-claude-launch",
    name: "GPT-4 & Claude Launch",
    shortLabel: "GPT-4 & Claude",
    date: "2023-03-14",
    type: "other",
    description: "OpenAI released GPT-4, Anthropic released Claude",
    significance: "major",
  },

  // 2024
  {
    id: "claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    shortLabel: "Claude 3.5",
    date: "2024-06-20",
    type: "anthropic",
    description: "Anthropic released Claude 3.5 Sonnet",
    significance: "major",
  },

  // 2025
  {
    id: "copilot-agent-mode",
    name: "GitHub Copilot Agent Mode",
    shortLabel: "Agent Mode",
    date: "2025-02-06",
    type: "copilot",
    description: "GitHub launched Copilot Agent Mode with autonomous coding",
    significance: "major",
  },
  {
    id: "frontier-models-2025",
    name: "GPT-5.1, Gemini 3 & Opus 4.5",
    shortLabel: "GPT-5.1/Gemini 3/Opus 4.5",
    date: "2025-11-15",
    type: "other",
    description: "OpenAI, Google, and Anthropic released frontier models",
    significance: "major",
  },
];

// Color scheme for different AI vendors
export const MILESTONE_COLORS: Record<AIMilestone["type"], string> = {
  copilot: "#6366f1", // Indigo (GitHub)
  openai: "#10b981", // Emerald (OpenAI green)
  anthropic: "#f97316", // Orange (Anthropic)
  google: "#3b82f6", // Blue (Google)
  other: "#6b7280", // Gray
};

// Get milestones within a date range
export function getMilestonesInRange(
  startDate: Date,
  endDate: Date,
  majorOnly = false
): AIMilestone[] {
  return AI_MILESTONES.filter((m) => {
    const date = new Date(m.date);
    const inRange = date >= startDate && date <= endDate;
    return majorOnly ? inRange && m.significance === "major" : inRange;
  });
}

// Get milestone by date for chart tooltips
export function getMilestoneByDate(date: string): AIMilestone | undefined {
  return AI_MILESTONES.find((m) => m.date === date);
}
