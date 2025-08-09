import { useState } from "react";
import { getPrediction, type Prediction } from "./services/predictions";

// Arătăm debug doar în dev sau dacă setăm VITE_SHOW_DEBUG=1
const SHOW_DEBUG =
  import.meta.env.MODE !== "production" ||
  import.meta.env.VITE_SHOW_DEBUG === "1";

export default function App() {
  const [fixtureId, setFixtureId] = useState("215662");
  const [data, setData] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const res = await getPrediction(Number(fixtureId));
      setData(res);
    } catch (err: any) {
      setError(err?.message || "Eroare necunoscută");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Footy Predictor Starter</h1>

        <form onSubmit={handleFetch} className="flex gap-3 items-center">
          <input
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.val
