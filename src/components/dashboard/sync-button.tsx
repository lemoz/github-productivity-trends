"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SyncStatus } from "@/types/metrics";

interface SyncButtonProps {
  syncStatus: SyncStatus | null;
  onSyncComplete?: () => void;
}

export function SyncButton({ syncStatus, onSyncComplete }: SyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Sync failed");
      }

      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const isRunning = isSyncing || syncStatus?.isRunning;

  return (
    <div className="flex items-center gap-4">
      <Button
        onClick={handleSync}
        disabled={isRunning}
        variant={isRunning ? "secondary" : "default"}
      >
        {isRunning ? (
          <>
            <svg
              className="mr-2 h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Syncing...
          </>
        ) : (
          "Sync GitHub Data"
        )}
      </Button>

      {syncStatus && (
        <div className="text-sm text-gray-500">
          <span>
            {syncStatus.usersTracked} users, {syncStatus.reposTracked} repos
          </span>
          {syncStatus.lastSyncAt && (
            <span className="ml-2">
              Last sync: {new Date(syncStatus.lastSyncAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
