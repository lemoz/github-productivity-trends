import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAISignals } from "@/lib/adoption";
import { getRateLimitStatus } from "@/lib/github";

// POST /api/adoption - scan repos/users for AI adoption signals
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const maxRepoPagesRaw = Number(searchParams.get("maxRepoPages") ?? 2);
  const perPageRaw = Number(searchParams.get("perPage") ?? 50);
  const maxRepoPages = Number.isFinite(maxRepoPagesRaw) ? maxRepoPagesRaw : 2;
  const perPage = Number.isFinite(perPageRaw) ? perPageRaw : 50;

  const job = await prisma.syncJob.create({
    data: {
      jobType: "adoption",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const result = await syncAISignals({ maxRepoPages, perPage });

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        itemsProcessed: result.reposScanned + result.usersUpdated,
        rateLimitRemaining: getRateLimitStatus().rest.remaining,
      },
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      ...result,
      rateLimitStatus: getRateLimitStatus(),
    });
  } catch (error) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
    });

    console.error("Adoption sync error:", error);
    return NextResponse.json(
      {
        error: "Adoption sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET /api/adoption - simple adoption summary
export async function GET() {
  const [usersWithAI, reposWithAI, totalSignals] = await Promise.all([
    prisma.sampledUser.count({ where: { aiAdoptionScore: { gt: 0 } } }),
    prisma.sampledRepo.count({ where: { aiAdoptionScore: { gt: 0 } } }),
    prisma.aISignal.count(),
  ]);

  return NextResponse.json({
    usersWithAI,
    reposWithAI,
    totalSignals,
  });
}

