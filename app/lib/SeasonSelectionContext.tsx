import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface SeasonSelectionValue {
  selectedSeasonId: string | null;
  setSelectedSeasonId: (seasonId: string | null) => void;
}

const SeasonSelectionContext = createContext<SeasonSelectionValue | null>(null);

export function SeasonSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const value = useMemo(
    () => ({ selectedSeasonId, setSelectedSeasonId }),
    [selectedSeasonId],
  );

  return (
    <SeasonSelectionContext.Provider value={value}>
      {children}
    </SeasonSelectionContext.Provider>
  );
}

/** Outside the app shell, null means the normal latest-season behaviour. */
export function useSeasonSelection() {
  return useContext(SeasonSelectionContext);
}
