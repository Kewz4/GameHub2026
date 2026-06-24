import { useState } from "react";
import { Button } from "@renderer/components";

export function MinervaCatalogueSection() {
  const [isBuilding, setIsBuilding] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const handleRefresh = async () => {
    setIsBuilding(true);
    setCounts(null);
    try {
      const result = await window.electron.buildMinervaCatalogue();
      if (typeof result === "object" && result !== null) {
        setCounts(result as Record<string, number>);
      }
    } catch (err) {
      console.error("[minerva] Failed to build catalogue:", err);
    } finally {
      setIsBuilding(false);
    }
  };

  const total = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <section
      className="settings-emulation__retroachievements"
      style={{ maxWidth: 640, marginBottom: 24 }}
    >
      <h3 style={{ margin: "0 0 4px" }}>Minerva ROM Catalogue</h3>
      <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
        Pre-fetch all ROM listings from Minerva Archive and store them locally
        so download options appear instantly when you open a game. This may take
        a few minutes.
      </p>

      {counts && (
        <div style={{ marginBottom: 12, fontSize: "0.875em", opacity: 0.8 }}>
          Cached {total?.toLocaleString()} ROMs across{" "}
          {Object.keys(counts).length} systems.
        </div>
      )}

      <Button type="button" onClick={handleRefresh} disabled={isBuilding}>
        {isBuilding ? "Building catalogue..." : "Refresh Minerva Catalogue"}
      </Button>
    </section>
  );
}
