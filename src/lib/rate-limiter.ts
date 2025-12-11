// Rate limiter for GitHub API
// REST: 5000 requests/hour (authenticated)
// Search: 30 requests/minute
// GraphQL: 5000 points/hour

interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: Date;
}

class GitHubRateLimiter {
  private restLimit: RateLimitState = {
    remaining: 5000,
    limit: 5000,
    resetAt: new Date(),
  };

  private searchLimit: RateLimitState = {
    remaining: 30,
    limit: 30,
    resetAt: new Date(),
  };

  private graphqlLimit: RateLimitState = {
    remaining: 5000,
    limit: 5000,
    resetAt: new Date(),
  };

  updateFromHeaders(
    headers: Record<string, string | undefined>,
    type: "rest" | "search" | "graphql"
  ) {
    const remaining = parseInt(headers["x-ratelimit-remaining"] || "5000", 10);
    const reset = parseInt(headers["x-ratelimit-reset"] || "0", 10);
    const limit = parseInt(headers["x-ratelimit-limit"] || "5000", 10);

    const state: RateLimitState = {
      remaining,
      limit,
      resetAt: new Date(reset * 1000),
    };

    switch (type) {
      case "rest":
        this.restLimit = state;
        break;
      case "search":
        this.searchLimit = state;
        break;
      case "graphql":
        this.graphqlLimit = state;
        break;
    }
  }

  async waitIfNeeded(type: "rest" | "search" | "graphql"): Promise<void> {
    const state =
      type === "rest"
        ? this.restLimit
        : type === "search"
          ? this.searchLimit
          : this.graphqlLimit;

    // Keep a buffer to avoid hitting hard limits
    const buffer = type === "search" ? 5 : 100;

    if (state.remaining <= buffer) {
      const waitMs = Math.max(0, state.resetAt.getTime() - Date.now() + 1000);
      if (waitMs > 0) {
        console.log(
          `[RateLimiter] ${type} limit reached (${state.remaining}/${state.limit}). Waiting ${Math.round(waitMs / 1000)}s until reset.`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  getStatus() {
    return {
      rest: { ...this.restLimit },
      search: { ...this.searchLimit },
      graphql: { ...this.graphqlLimit },
    };
  }

  canMakeRequest(type: "rest" | "search" | "graphql"): boolean {
    const state =
      type === "rest"
        ? this.restLimit
        : type === "search"
          ? this.searchLimit
          : this.graphqlLimit;
    const buffer = type === "search" ? 5 : 100;
    return state.remaining > buffer || state.resetAt < new Date();
  }
}

// Singleton instance
export const rateLimiter = new GitHubRateLimiter();
