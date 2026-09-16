import { beforeEach, describe, expect, it, vi } from "vitest";

const { updates } = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }));

vi.mock("../app/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return {
          eq: () => ({
            select: async () => ({ data: [{ id: "match-1" }], error: null }),
          }),
        };
      },
    }),
  },
}));

const { updateMatch } = await import("../app/lib/adminMutations.js");

describe("admin match finalisation timestamps", () => {
  beforeEach(() => updates.splice(0));

  it("preserves finalised_at when editing metadata on an already-finalised match", async () => {
    await updateMatch(
      "match-1",
      {
        grade: "A Grade",
        opponent: "Updated opponent",
        status: "finalised",
        finalDayDate: "2026-09-12",
      },
      "finalised",
    );

    expect(updates).toEqual([
      {
        grade: "A Grade",
        opponent: "Updated opponent",
        final_day_date: "2026-09-12",
      },
    ]);
    expect(updates[0]).not.toHaveProperty("finalised_at");
  });

  it("stamps a genuine transition to finalised", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T05:30:00.000Z"));

    await updateMatch("match-1", { status: "finalised" }, "in_progress");

    expect(updates).toEqual([
      { status: "finalised", finalised_at: "2026-09-16T05:30:00.000Z" },
    ]);
    vi.useRealTimers();
  });

  it("clears finalised_at when reopening a finalised match", async () => {
    await updateMatch("match-1", { status: "in_progress" }, "finalised");

    expect(updates).toEqual([{ status: "in_progress", finalised_at: null }]);
  });
});
