import { prisma } from "@/lib/prisma";
import {
  getRepoPRs,
  getRepoReadme,
  listRepoRootFiles,
  listRepoDirFiles,
} from "@/lib/github";

type PatternSpec = {
  signalType: string;
  regex: RegExp;
  weight: number;
};

const AI_TEXT_PATTERNS: PatternSpec[] = [
  {
    signalType: "copilot_coauthored",
    regex: /co-authored-by:\s*github copilot/i,
    weight: 3,
  },
  {
    signalType: "copilot_mention",
    regex: /\b(github\s+copilot|copilot)\b/i,
    weight: 2,
  },
  {
    signalType: "chatgpt_mention",
    regex: /\b(chatgpt|gpt-?4|gpt-?5|openai)\b/i,
    weight: 1.5,
  },
  {
    signalType: "claude_mention",
    regex: /\b(claude|anthropic)\b/i,
    weight: 1.5,
  },
  {
    signalType: "gemini_mention",
    regex: /\b(gemini)\b/i,
    weight: 1.2,
  },
  {
    signalType: "cursor_mention",
    regex: /\b(cursor)\b/i,
    weight: 1.2,
  },
];

const AI_CONFIG_PATTERNS: PatternSpec[] = [
  {
    signalType: "ai_config_file",
    regex:
      /(^|\/)(\.cursorrules|\.cursor|copilot\.ya?ml|copilot-instructions\.md|ai\.md|ai-instructions\.md|\.github\/copilot\.ya?ml|\.github\/copilot-instructions\.md|\.github\/ai\.ya?ml)$/i,
    weight: 2,
  },
];

function extractMatches(text: string, patterns: PatternSpec[]) {
  const matches: Array<{ spec: PatternSpec; count: number }> = [];
  for (const spec of patterns) {
    const flags = spec.regex.flags.includes("g")
      ? spec.regex.flags
      : `${spec.regex.flags}g`;
    const found = text.match(new RegExp(spec.regex.source, flags));
    if (found && found.length > 0) {
      matches.push({ spec, count: found.length });
    }
  }
  return matches;
}

async function upsertSignal(params: {
  signalType: string;
  source: string;
  seenAt: Date;
  occurrences: number;
  examples?: string[];
  userId?: string | null;
  repoId?: string | null;
}) {
  const { signalType, source, seenAt, occurrences, examples, userId, repoId } = params;

  const existing = await prisma.aISignal.findFirst({
    where: {
      signalType,
      source,
      userId: userId ?? null,
      repoId: repoId ?? null,
    },
  });

  if (existing) {
    await prisma.aISignal.update({
      where: { id: existing.id },
      data: {
        occurrences: existing.occurrences + occurrences,
        lastSeenAt: seenAt,
        examples: examples
          ? JSON.stringify(
              Array.from(
                new Set([
                  ...(existing.examples ? JSON.parse(existing.examples) : []),
                  ...examples,
                ])
              ).slice(0, 5)
            )
          : existing.examples,
      },
    });
  } else {
    await prisma.aISignal.create({
      data: {
        signalType,
        source,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        occurrences,
        examples: examples ? JSON.stringify(examples.slice(0, 5)) : null,
        userId: userId ?? null,
        repoId: repoId ?? null,
      },
    });
  }
}

function computeAdoptionScore(signals: Array<{ signalType: string; occurrences: number }>) {
  let score = 0;
  for (const s of signals) {
    const spec =
      AI_TEXT_PATTERNS.find((p) => p.signalType === s.signalType) ||
      AI_CONFIG_PATTERNS.find((p) => p.signalType === s.signalType);
    const weight = spec?.weight ?? 1;
    const scaled = Math.min(1, Math.log10(s.occurrences + 1));
    score += weight * scaled;
  }
  return score;
}

async function updateRepoAggregate(repoId: string) {
  const signals = await prisma.aISignal.findMany({ where: { repoId } });
  if (signals.length === 0) return;

  const firstSeen = signals.reduce<Date | null>((min, s) => {
    const d = s.firstSeenAt;
    return !min || d < min ? d : min;
  }, null);

  const score = computeAdoptionScore(signals);

  await prisma.sampledRepo.update({
    where: { id: repoId },
    data: {
      aiAdoptionFirstSeenAt: firstSeen,
      aiAdoptionScore: score,
    },
  });
}

async function updateUserAggregate(userId: string) {
  const signals = await prisma.aISignal.findMany({ where: { userId } });
  if (signals.length === 0) return;

  const firstSeen = signals.reduce<Date | null>((min, s) => {
    const d = s.firstSeenAt;
    return !min || d < min ? d : min;
  }, null);

  const score = computeAdoptionScore(signals);

  await prisma.sampledUser.update({
    where: { id: userId },
    data: {
      aiAdoptionFirstSeenAt: firstSeen,
      aiAdoptionScore: score,
    },
  });
}

export async function syncAISignals(options?: {
  maxRepoPages?: number;
  perPage?: number;
}) {
  const maxRepoPages = options?.maxRepoPages ?? 2;
  const perPage = options?.perPage ?? 50;

  const repos = await prisma.sampledRepo.findMany();
  const affectedUsers = new Set<string>();

  for (const repo of repos) {
    const owner = repo.owner;
    const name = repo.name;

    // PR text signals
    for (let page = 1; page <= maxRepoPages; page++) {
      const prs = (await getRepoPRs(
        owner,
        name,
        "all",
        perPage,
        page
      )) as unknown as Array<{
        title: string | null;
        body: string | null;
        created_at: string;
        user?: { login?: string };
      }>;
      if (prs.length === 0) break;

      for (const pr of prs) {
        const text = `${pr.title || ""}\n${pr.body || ""}`.trim();
        if (!text) continue;

        const matches = extractMatches(text, AI_TEXT_PATTERNS);
        if (matches.length === 0) continue;

        const seenAt = pr.created_at ? new Date(pr.created_at) : new Date();
        const authorLogin: string | undefined = pr.user?.login;

        let authorId: string | null = null;
        if (authorLogin) {
          const user = await prisma.sampledUser.findUnique({
            where: { username: authorLogin },
          });
          authorId = user?.id || null;
        }

        for (const match of matches) {
          await upsertSignal({
            signalType: match.spec.signalType,
            source: "pr_text",
            seenAt,
            occurrences: match.count,
            examples: pr.title ? [pr.title] : undefined,
            repoId: repo.id,
            userId: authorId,
          });

          if (authorId) affectedUsers.add(authorId);
        }
      }

      if (prs.length < perPage) break;
    }

    // README signals
    const readme = await getRepoReadme(owner, name);
    if (readme) {
      const matches = extractMatches(readme, AI_TEXT_PATTERNS);
      for (const match of matches) {
        await upsertSignal({
          signalType: match.spec.signalType,
          source: "readme",
          seenAt: new Date(),
          occurrences: match.count,
          examples: [readme.slice(0, 200)],
          repoId: repo.id,
        });
      }
    }

    // Config / file footprint signals
    const rootFiles = await listRepoRootFiles(owner, name);
    const githubFiles = rootFiles.includes(".github")
      ? await listRepoDirFiles(owner, name, ".github")
      : [];
    const combinedPaths = [
      ...rootFiles.map((f) => f),
      ...githubFiles.map((f) => `.github/${f}`),
    ].join("\n");

    const configMatches = extractMatches(combinedPaths, AI_CONFIG_PATTERNS);
    for (const match of configMatches) {
      await upsertSignal({
        signalType: match.spec.signalType,
        source: "config",
        seenAt: new Date(),
        occurrences: match.count,
        examples: [combinedPaths],
        repoId: repo.id,
      });
    }

    await updateRepoAggregate(repo.id);
  }

  for (const userId of affectedUsers) {
    await updateUserAggregate(userId);
  }

  return {
    reposScanned: repos.length,
    usersUpdated: affectedUsers.size,
  };
}
