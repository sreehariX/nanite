"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface SystemPrompt {
  id: string;
  content: string;
}

interface GlobalResult {
  model: string;
  prompt_id: string;
  prompt_content: string;
  critical_detection_rate: number;
  hallucination_rate: number;
  helpfulness_rate: number;
  passed: boolean;
  details: any[];
}

interface PR {
  id: number;
  title: string;
  diff: string;
  url: string;
  merged: boolean;
  author: string;
  selected: boolean;
  expectedFocus: string;
}

interface RepoData {
  repo: string;
  owner: string;
  repo_name: string;
}

interface RepoResult {
  model: string;
  promptId: string;
  promptContent: string;
  criticalDetectionRate: number;
  hallucinationRate: number;
  helpfulnessRate: number;
  passed: boolean;
  verdict: "Recommended" | "Acceptable" | "Rejected";
  explanation: string;
  rank: number;
  details?: any[];
}

const steps = ["Repository", "Global Filter", "Select PRs", "Finalize PRs", "Results"];

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n").slice(0, 100);
  return (
    <pre className="text-[13px] leading-relaxed overflow-x-auto">
      {lines.map((line, i) => {
        let className = "text-zinc-400";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "diff-add";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "diff-remove";
        } else if (line.startsWith("@@") || line.startsWith("diff")) {
          className = "diff-header";
        }
        return (
          <div key={i} className={`${className} px-3 -mx-3`}>
            {line || " "}
          </div>
        );
      })}
      {diff.split("\n").length > 100 && (
        <div className="text-zinc-500 px-3 -mx-3">... ({diff.split("\n").length - 100} more lines)</div>
      )}
    </pre>
  );
}

function ProgressIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <motion.div
            className="relative flex items-center justify-center"
            initial={false}
            animate={{ scale: i === current ? 1 : 0.9 }}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300 ${
                i < current
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : i === current
                  ? "bg-zinc-800 text-white border border-zinc-600"
                  : "bg-zinc-900 text-zinc-600 border border-zinc-800"
              }`}
            >
              {i < current ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i === current && (
              <motion.div
                className="absolute inset-0 rounded-full border border-green-500/50"
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.3, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
          </motion.div>
          {i < total - 1 && (
            <div
              className={`w-8 h-px mx-1 transition-colors duration-300 ${
                i < current ? "bg-green-500/30" : "bg-zinc-800"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";


export default function App() {
  const [step, setStep] = useState(0);
  const [repo, setRepo] = useState("");
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedPR, setExpandedPR] = useState<number | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [globalResults, setGlobalResults] = useState<GlobalResult[]>([]);
  const [evalProgress, setEvalProgress] = useState({
    current: 0,
    total: 0,
    status: "",
    currentModel: "",
    currentPrompt: "",
    currentPr: "",
    currentStep: "",
    subProgress: 0,
    subTotal: 0,
    elapsedTime: 0,
    logs: [] as string[]
  });
  const [repoResults, setRepoResults] = useState<RepoResult[]>([]);

  useEffect(() => {
    fetchModelsAndPrompts();
  }, []);

  const fetchModelsAndPrompts = async () => {
    try {
      const [modelsRes, promptsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/eval/models`),
        fetch(`${API_BASE_URL}/api/eval/prompts`),
      ]);

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setModels(data.models);
      }

      if (promptsRes.ok) {
        const data = await promptsRes.json();
        setPrompts(data.prompts);
      }
    } catch (err) {
      console.error("Failed to fetch models/prompts:", err);
      setModels(["gemini-1.5-flash", "gemini-1.5-pro"]);
      setPrompts([
        { id: "prompt-1", content: "You are an AI code reviewer. Review the following pull request and identify any issues, bugs, or improvements. Be concise and actionable in your feedback." },
        { id: "prompt-2", content: "You are an AI assistant that reviews code changes. Analyze the diff provided and point out potential bugs, security concerns, performance issues, and code quality improvements." },
      ]);
    }
  };

  const togglePR = (id: number) => {
    setPrs((prev) =>
      prev.map((pr) => (pr.id === id ? { ...pr, selected: !pr.selected } : pr))
    );
  };

  const updateExpectedFocus = (id: number, value: string) => {
    setPrs((prev) =>
      prev.map((pr) => (pr.id === id ? { ...pr, expectedFocus: value } : pr))
    );
  };

  const selectedCount = prs.filter((pr) => pr.selected).length;
  const passedCount = globalResults.filter((r) => r.passed).length;
  const failedCount = globalResults.filter((r) => !r.passed).length;

  const fetchPRs = async () => {
    setIsLoading(true);
    setLoadingMessage("Fetching PRs from GitHub...");
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/prs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repo, limit: 20 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to fetch PRs");
      }

      const data = await response.json();
      setRepoData({
        repo: data.repo,
        owner: data.owner,
        repo_name: data.repo_name,
      });

      const fetchedPRs: PR[] = data.prs.map((pr: any, index: number) => ({
        id: pr.id,
        title: pr.title,
        diff: pr.diff,
        url: pr.url,
        merged: pr.merged,
        author: pr.author,
        selected: index < 15,
        expectedFocus: "",
      }));

      setPrs(fetchedPRs);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch PRs");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const runGlobalEvaluation = async () => {
    setIsLoading(true);
    setLoadingMessage("Starting global evaluation...");
    setError(null);
    setGlobalResults([]);

    try {
      const startRes = await fetch(`${API_BASE_URL}/api/eval/global/start`, {
        method: "POST",
      });

      if (!startRes.ok) {
        const errData = await startRes.json();
        throw new Error(errData.detail || "Failed to start evaluation");
      }

      const startData = await startRes.json();
      setEvalProgress({
        current: 0,
        total: startData.total_combinations,
        status: "running",
        currentModel: "",
        currentPrompt: "",
        currentPr: "",
        currentStep: "Initializing...",
        subProgress: 0,
        subTotal: 0,
        elapsedTime: 0,
        logs: []
      });

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/eval/global/status`);
          const statusData = await statusRes.json();

          if (statusData.status === "running") {
            setEvalProgress({
              current: statusData.progress || 0,
              total: statusData.total || startData.total_combinations,
              status: "running",
              currentModel: statusData.current_model || "",
              currentPrompt: statusData.current_prompt || "",
              currentPr: statusData.current_pr || "",
              currentStep: statusData.current_step || "Processing...",
              subProgress: statusData.sub_progress || 0,
              subTotal: statusData.sub_total || 0,
              elapsedTime: statusData.elapsed_time || 0,
              logs: statusData.logs || []
            });
            setLoadingMessage(statusData.current_step || "Processing...");
          } else if (statusData.status === "complete") {
            clearInterval(pollInterval);
            setGlobalResults(statusData.results || []);
            setEvalProgress(prev => ({ ...prev, logs: statusData.logs || prev.logs, elapsedTime: statusData.elapsed_time || prev.elapsedTime }));
            setIsLoading(false);
            setLoadingMessage("");
            setStep(1);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (isLoading) {
          setError("Evaluation timed out. Please try again.");
          setIsLoading(false);
        }
      }, 600000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run evaluation");
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const generateExpectedFocus = async () => {
    setIsLoading(true);
    setLoadingMessage("Analyzing PRs to generate expected focus areas...");
    setError(null);

    try {
      const selectedPRs = prs.filter((pr) => pr.selected);
      
      const response = await fetch(`${API_BASE_URL}/api/eval/generate-focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prs: selectedPRs.map((pr) => ({
            id: pr.id,
            title: pr.title,
            diff: pr.diff,
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Failed to generate focus");
      }

      const data = await response.json();
      const focusMap = new Map<number, { id: number; focus: string; explanation: string }>(
        data.results.map((r: any) => [r.id, r])
      );

      const updatedPRs = prs.map((pr) => {
        if (pr.selected && focusMap.has(pr.id)) {
          const focusData = focusMap.get(pr.id)!;
          return { ...pr, expectedFocus: focusData.focus };
        }
        return pr;
      });

      setPrs(updatedPRs);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate focus");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const handleStep1Continue = () => {
    runGlobalEvaluation();
  };

  const handleStep2Continue = () => {
    fetchPRs();
  };

  const handleStep3Continue = () => {
    generateExpectedFocus();
  };

  const handleStep4Continue = async () => {
    setIsLoading(true);
    setLoadingMessage("Starting repo-specific evaluation...");
    setError(null);

    try {
      const selectedPRs = prs.filter((pr) => pr.selected);
      
      const startRes = await fetch(`${API_BASE_URL}/api/eval/repo/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prs: selectedPRs.map((pr) => ({
            id: pr.id,
            title: pr.title,
            diff: pr.diff,
            expectedFocus: pr.expectedFocus,
          })),
        }),
      });

      if (!startRes.ok) {
        const errData = await startRes.json();
        throw new Error(errData.detail || "Failed to start evaluation");
      }

      const startData = await startRes.json();
      setEvalProgress({
        current: 0,
        total: startData.total_combinations,
        status: "running",
        currentModel: "",
        currentPrompt: "",
        currentPr: "",
        currentStep: "Initializing...",
        subProgress: 0,
        subTotal: 0,
        elapsedTime: 0,
        logs: []
      });

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/eval/repo/status`);
          const statusData = await statusRes.json();

          if (statusData.status === "running") {
            setEvalProgress({
              current: statusData.progress || 0,
              total: statusData.total || startData.total_combinations,
              status: "running",
              currentModel: statusData.current_model || "",
              currentPrompt: statusData.current_prompt || "",
              currentPr: statusData.current_pr || "",
              currentStep: statusData.current_step || `Evaluating ${statusData.current_model} + ${statusData.current_prompt}`,
              subProgress: statusData.sub_progress || 0,
              subTotal: statusData.sub_total || 0,
              elapsedTime: statusData.elapsed_time || 0,
              logs: statusData.logs || []
            });
            setLoadingMessage(statusData.current_step || "Processing...");
          } else if (statusData.status === "complete") {
            clearInterval(pollInterval);
            setRepoResults(statusData.results || []);
            setEvalProgress(prev => ({ ...prev, logs: statusData.logs || prev.logs, elapsedTime: statusData.elapsed_time || prev.elapsedTime }));
            setIsLoading(false);
            setLoadingMessage("");
            setStep(4);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (isLoading) {
          setError("Evaluation timed out. Please try again.");
          setIsLoading(false);
        }
      }, 600000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run evaluation");
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const pageVariants = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="gradient-blur" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">nanite</span>
          </div>
          <ProgressIndicator current={step} total={steps.length} />
        </header>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="repo"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">
                  Find the best model + system prompt for PR reviews
                </h1>
                <p className="text-zinc-400 text-lg leading-relaxed">
                  We evaluate different model and system prompt combinations against your real PRs
                  to find the configuration that catches issues that matter in your codebase.
                </p>
              </div>

              <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                <CardContent className="p-6">
                  <label className="text-sm font-medium text-zinc-300 block mb-3">
                    Repository URL
                  </label>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://github.com/owner/repo"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      className="flex-1 bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-600 h-11 focus:border-zinc-700 focus:ring-zinc-700"
                    />
                    <Button
                      disabled={!repo || isLoading}
                      onClick={handleStep1Continue}
                      className="bg-white text-black hover:bg-zinc-200 h-11 px-6 font-medium"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                          <span>{loadingMessage || "Running..."}</span>
                        </div>
                      ) : (
                        "Run Global Eval"
                      )}
                    </Button>
                  </div>
                  {error && (
                    <p className="text-red-400 text-sm mt-3">{error}</p>
                  )}
                </CardContent>
              </Card>

              {/* Detailed Progress Panel */}
              {isLoading && evalProgress.total > 0 && (
                <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">Evaluation Progress</h3>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 border border-zinc-700">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-xs text-zinc-400">
                            {Math.floor(evalProgress.elapsedTime / 60)}:{(evalProgress.elapsedTime % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm text-zinc-400">
                        {evalProgress.current}/{evalProgress.total} combinations
                      </span>
                    </div>
                    
                    {/* Main Progress Bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-zinc-500 mb-1">
                        <span>Overall Progress</span>
                        <span>{((evalProgress.current / evalProgress.total) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-green-500 to-green-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${(evalProgress.current / evalProgress.total) * 100}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>

                    {/* Sub Progress Bar */}
                    {evalProgress.subTotal > 0 && (
                      <div className="mb-6">
                        <div className="flex justify-between text-xs text-zinc-500 mb-1">
                          <span>Current Combination: PR {evalProgress.subProgress}/{evalProgress.subTotal}</span>
                          <span>{((evalProgress.subProgress / evalProgress.subTotal) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
                            initial={{ width: 0 }}
                            animate={{ width: `${(evalProgress.subProgress / evalProgress.subTotal) * 100}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Current Status */}
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current Model</p>
                        <p className="text-sm font-mono text-green-400">
                          {evalProgress.currentModel || "—"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current Prompt</p>
                        <p className="text-sm font-mono text-blue-400">
                          {evalProgress.currentPrompt || "—"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current PR</p>
                        <p className="text-sm font-mono text-amber-400">
                          {evalProgress.currentPr || "—"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current Step</p>
                        <p className="text-sm text-zinc-300 truncate">
                          {evalProgress.currentStep || "—"}
                        </p>
                      </div>
                    </div>

                    {/* Live Logs */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <p className="text-xs text-zinc-500">Live Logs</p>
                      </div>
                      <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 h-48 overflow-auto font-mono text-xs">
                        {evalProgress.logs.length === 0 ? (
                          <p className="text-zinc-600">Waiting for logs...</p>
                        ) : (
                          evalProgress.logs.map((log, idx) => (
                            <div
                              key={idx}
                              className={`py-0.5 ${
                                log.includes("✅") ? "text-green-400" :
                                log.includes("❌") ? "text-red-400" :
                                log.includes("⚠️") ? "text-amber-400" :
                                log.includes("🚀") || log.includes("🏁") ? "text-blue-400" :
                                log.includes("📊") || log.includes("📋") ? "text-purple-400" :
                                log.includes("🤖") ? "text-cyan-400" :
                                log.includes("===") ? "text-zinc-500" :
                                "text-zinc-400"
                              }`}
                            >
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Models ({models.length})</h3>
                  <div className="flex flex-wrap gap-2">
                    {models.map((model) => (
                      <span key={model} className="text-sm px-3 py-1.5 rounded-lg bg-zinc-800/50 text-zinc-300 border border-zinc-700/50">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">System Prompts ({prompts.length})</h3>
                  <div className="space-y-2 max-h-[40vh] overflow-auto">
                    {prompts.map((prompt, idx) => (
                      <div
                        key={prompt.id}
                        className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-all cursor-pointer"
                        onClick={() => setExpandedPrompt(expandedPrompt === prompt.id ? null : prompt.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-zinc-500 mb-1">Prompt {idx + 1}</p>
                            <p className="text-sm text-zinc-300 line-clamp-2 font-mono">
                              {prompt.content.slice(0, 100)}...
                            </p>
                          </div>
                          <svg
                            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expandedPrompt === prompt.id ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        <AnimatePresence>
                          {expandedPrompt === prompt.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <pre className="mt-3 p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800">
                                {prompt.content}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="global"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-start justify-between gap-8">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Global Safety Filter
                  </h2>
                  <p className="text-zinc-400">
                    Tested {models.length} models x {prompts.length} system prompts = {globalResults.length} combinations
                    using LLM-as-judge evaluation.
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <div className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                    <span className="text-green-400 font-semibold">{passedCount}</span>
                    <span className="text-zinc-500 ml-2 text-sm">passed</span>
                  </div>
                  <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <span className="text-red-400 font-semibold">{failedCount}</span>
                    <span className="text-zinc-500 ml-2 text-sm">filtered</span>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 max-h-[55vh] overflow-auto pr-1">
                {globalResults.map((r, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className={`p-4 rounded-lg border transition-all ${
                      !r.passed
                        ? "bg-red-950/20 border-red-900/30"
                        : "bg-zinc-900/50 border-zinc-800/50 hover:border-zinc-700/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-zinc-200">{r.model}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{r.prompt_id}</p>
                      </div>
                      <div
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          r.passed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {r.passed ? "PASS" : "FILTERED"}
                      </div>
                    </div>
                    <div className="mb-3">
                      <div
                        className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1"
                        onClick={() => setExpandedPrompt(expandedPrompt === `global-${idx}` ? null : `global-${idx}`)}
                      >
                        <span>System Prompt</span>
                        <svg
                          className={`w-3 h-3 transition-transform ${expandedPrompt === `global-${idx}` ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <AnimatePresence>
                        {expandedPrompt === `global-${idx}` ? (
                          <motion.pre
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="mt-2 p-2 bg-zinc-950 rounded text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 max-h-40 overflow-auto"
                          >
                            {r.prompt_content}
                          </motion.pre>
                        ) : (
                          <p className="text-xs text-zinc-500 mt-1 font-mono line-clamp-1">
                            {r.prompt_content.slice(0, 60)}...
                          </p>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Critical Detection</span>
                        <span className={`font-mono ${r.critical_detection_rate >= 0.6 ? "text-green-400" : "text-red-400"}`}>
                          {(r.critical_detection_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${r.critical_detection_rate >= 0.6 ? "bg-green-500" : "bg-red-500"}`}
                          style={{ width: `${r.critical_detection_rate * 100}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Hallucination</span>
                        <span className={`font-mono ${r.hallucination_rate <= 0.2 ? "text-green-400" : "text-red-400"}`}>
                          {(r.hallucination_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${r.hallucination_rate <= 0.2 ? "bg-green-500" : "bg-red-500"}`}
                          style={{ width: `${r.hallucination_rate * 100}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Helpfulness</span>
                        <span className="font-mono text-zinc-300">
                          {(r.helpfulness_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {error && (
                <div className="p-4 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleStep2Continue}
                  disabled={isLoading || passedCount === 0}
                  className="bg-white text-black hover:bg-zinc-200 font-medium"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <span>{loadingMessage || "Loading..."}</span>
                    </div>
                  ) : (
                    `Fetch PRs (${passedCount} combinations passed)`
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="select-prs"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-start justify-between gap-8">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Select PRs for Evaluation
                  </h2>
                  {repoData && (
                    <p className="text-zinc-400 mb-2">
                      Repository: <span className="text-zinc-200 font-mono">{repoData.repo}</span>
                    </p>
                  )}
                  <p className="text-zinc-500 text-sm">
                    {prs.length} closed PRs fetched. Select which PRs to use for evaluation.
                  </p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 shrink-0">
                  <span className="text-white font-semibold">{selectedCount}</span>
                  <span className="text-zinc-500 ml-1">/ {prs.length} selected</span>
                </div>
              </div>

              <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                {prs.map((pr, idx) => (
                  <motion.div
                    key={pr.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                  >
                    <Card
                      className={`bg-zinc-900/50 border-zinc-800 transition-all hover:border-zinc-700 ${
                        pr.selected ? "border-zinc-700" : "opacity-50"
                      }`}
                    >
                      <CardContent className="p-0">
                        <div
                          className="flex items-center gap-4 p-4 cursor-pointer select-none"
                          onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id)}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={pr.selected}
                              onCheckedChange={() => togglePR(pr.id)}
                              className="border-zinc-600 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                                #{pr.id}
                              </span>
                              <span className="font-medium text-zinc-200 truncate">
                                {pr.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-zinc-600">by {pr.author}</span>
                              {pr.merged && (
                                <span className="text-xs text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">merged</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              View on GitHub
                            </a>
                            <svg
                              className={`w-4 h-4 text-zinc-500 transition-transform ${
                                expandedPR === pr.id ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedPR === pr.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 border-t border-zinc-800">
                                <div className="pt-4 bg-zinc-950 rounded-lg p-3 font-mono max-h-80 overflow-auto">
                                  {pr.diff ? (
                                    <DiffViewer diff={pr.diff} />
                                  ) : (
                                    <p className="text-zinc-500 text-sm">No diff available</p>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(1)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleStep3Continue}
                  disabled={selectedCount === 0 || isLoading}
                  className="bg-white text-black hover:bg-zinc-200 font-medium"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <span>{loadingMessage || "Loading..."}</span>
                    </div>
                  ) : (
                    `Generate Expected Focus (${selectedCount} PRs)`
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="review-focus"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-start justify-between gap-8">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Finalize Pull Requests
                  </h2>
                  {repoData && (
                    <p className="text-zinc-400 mb-2">
                      Repository: <span className="text-zinc-200 font-mono">{repoData.repo}</span>
                    </p>
                  )}
                  <p className="text-zinc-500 text-sm">
                    AI analyzed your PRs and generated expected focus areas. Review and edit if needed before evaluation.
                  </p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20 shrink-0">
                  <span className="text-green-400 font-semibold">{selectedCount}</span>
                  <span className="text-zinc-500 ml-1">PRs ready</span>
                </div>
              </div>

              {isLoading && evalProgress.total > 0 && (
                <Card className="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">Running Evaluation</h3>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 border border-zinc-700">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-xs text-zinc-400">
                            {Math.floor(evalProgress.elapsedTime / 60)}:{(evalProgress.elapsedTime % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm text-zinc-400">
                        {evalProgress.current}/{evalProgress.total} combinations
                      </span>
                    </div>
                    
                    {/* Main Progress */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-zinc-500 mb-1">
                        <span>Overall Progress</span>
                        <span>{((evalProgress.current / evalProgress.total) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-green-500 to-green-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${(evalProgress.current / evalProgress.total) * 100}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>

                    {/* Sub Progress */}
                    {evalProgress.subTotal > 0 && (
                      <div className="mb-6">
                        <div className="flex justify-between text-xs text-zinc-500 mb-1">
                          <span>Current Combination: PR {evalProgress.subProgress}/{evalProgress.subTotal}</span>
                          <span>{((evalProgress.subProgress / evalProgress.subTotal) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
                            initial={{ width: 0 }}
                            animate={{ width: `${(evalProgress.subProgress / evalProgress.subTotal) * 100}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Model</p>
                        <p className="text-sm font-mono text-green-400">
                          {evalProgress.currentModel || "-"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Prompt</p>
                        <p className="text-sm font-mono text-blue-400">
                          {evalProgress.currentPrompt || "-"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current PR</p>
                        <p className="text-sm font-mono text-amber-400">
                          {evalProgress.currentPr || "-"}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                        <p className="text-xs text-zinc-500 mb-1">Current Step</p>
                        <p className="text-sm text-zinc-300 truncate">
                          {evalProgress.currentStep || "-"}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <p className="text-xs text-zinc-500">Live Logs</p>
                      </div>
                      <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 h-40 overflow-auto font-mono text-xs">
                        {evalProgress.logs.length === 0 ? (
                          <p className="text-zinc-600">Waiting for logs...</p>
                        ) : (
                          evalProgress.logs.map((log, idx) => (
                            <div
                              key={idx}
                              className={`py-0.5 ${
                                log.includes("✅") ? "text-green-400" :
                                log.includes("❌") ? "text-red-400" :
                                log.includes("⚠️") ? "text-amber-400" :
                                log.includes("🚀") || log.includes("🏁") ? "text-blue-400" :
                                log.includes("📊") || log.includes("📋") ? "text-purple-400" :
                                log.includes("🤖") ? "text-cyan-400" :
                                log.includes("===") ? "text-zinc-500" :
                                "text-zinc-400"
                              }`}
                            >
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                {prs.filter((pr) => pr.selected).map((pr, idx) => (
                  <motion.div
                    key={pr.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                  >
                    <Card className="bg-zinc-900/50 border-zinc-800 transition-all hover:border-zinc-700">
                      <CardContent className="p-0">
                        <div
                          className="flex items-center gap-4 p-4 cursor-pointer select-none"
                          onClick={() => setExpandedPR(expandedPR === pr.id ? null : pr.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                                #{pr.id}
                              </span>
                              <span className="font-medium text-zinc-200 truncate">
                                {pr.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-zinc-500">Expected Focus:</span>
                              <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                                {pr.expectedFocus}
                              </span>
                            </div>
                          </div>
                          <svg
                            className={`w-4 h-4 text-zinc-500 transition-transform ${
                              expandedPR === pr.id ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        <AnimatePresence>
                          {expandedPR === pr.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
                                <div className="pt-4 bg-zinc-950 rounded-lg p-3 font-mono max-h-60 overflow-auto">
                                  {pr.diff ? (
                                    <DiffViewer diff={pr.diff} />
                                  ) : (
                                    <p className="text-zinc-500 text-sm">No diff available</p>
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-zinc-500 block mb-2">
                                    Edit Expected Focus
                                  </label>
                                  <Input
                                    value={pr.expectedFocus}
                                    onChange={(e) => updateExpectedFocus(pr.id, e.target.value)}
                                    placeholder="e.g., security, performance, error handling"
                                    className="bg-zinc-950 border-zinc-800 text-zinc-200 text-sm h-9 font-mono focus:border-zinc-700"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(2)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleStep4Continue}
                  disabled={isLoading}
                  className="bg-white text-black hover:bg-zinc-200 font-medium"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <span>{loadingMessage || "Loading..."}</span>
                    </div>
                  ) : (
                    "Run Evaluation"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="results"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="flex items-start justify-between">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-white mb-2">
                    Evaluation Results
                  </h2>
                  <p className="text-zinc-400">
                    {repoResults.length} model + system prompt combinations ranked by detection accuracy.
                  </p>
                  {repoData && (
                    <p className="text-zinc-500 text-sm mt-1">
                      Repository: <span className="font-mono">{repoData.repo}</span>
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setShowAllResults(!showAllResults)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800 border border-zinc-800"
                >
                  {showAllResults ? "Show Top Results" : "Show All Results"}
                </Button>
              </div>

              {repoResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="relative rounded-2xl border border-green-500/20 bg-gradient-to-b from-green-500/5 to-transparent p-6 overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-xs font-medium px-2 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                          BEST MATCH
                        </span>
                        <span className="text-xs text-zinc-600">#1 of {repoResults.length}</span>
                      </div>
                      <h3 className="text-2xl font-semibold text-white mb-3">
                        {repoResults[0].model}
                      </h3>
                      <p className="text-zinc-400 text-sm mb-4">
                        {repoResults[0].explanation}
                      </p>
                      <div>
                        <div
                          className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1 mb-2"
                          onClick={() => setExpandedPrompt(expandedPrompt === "best" ? null : "best")}
                        >
                          <span>System Prompt</span>
                          <svg
                            className={`w-3 h-3 transition-transform ${expandedPrompt === "best" ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        <AnimatePresence>
                          {expandedPrompt === "best" ? (
                            <motion.pre
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 overflow-hidden"
                            >
                              {repoResults[0].promptContent}
                            </motion.pre>
                          ) : (
                            <div className="p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 font-mono border border-zinc-800 line-clamp-2">
                              {repoResults[0].promptContent.slice(0, 120)}...
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <div className="flex gap-6 shrink-0">
                      <div className="text-center">
                        <div className="text-3xl font-semibold text-green-400 mb-1">
                          {(repoResults[0].criticalDetectionRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-zinc-500">Detection</div>
                      </div>
                      <div className="text-center">
                        <div className="text-3xl font-semibold text-red-400 mb-1">
                          {(repoResults[0].hallucinationRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-zinc-500">Hallucination</div>
                      </div>
                      <div className="text-center">
                        <div className="text-3xl font-semibold text-blue-400 mb-1">
                          {(repoResults[0].helpfulnessRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-zinc-500">Helpful</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="space-y-3">
                <h3 className="text-sm font-medium text-zinc-400">
                  {showAllResults ? "All Rankings" : "Top Alternatives"}
                </h3>

                <div className={`space-y-2 ${showAllResults ? "max-h-[45vh] overflow-auto pr-1" : ""}`}>
                  {(showAllResults ? repoResults.slice(1) : repoResults.slice(1, 6)).map((r, idx) => (
                    <motion.div
                      key={`${r.model}-${r.promptId}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + idx * 0.03 }}
                    >
                      <Card
                        className={`bg-zinc-900/50 border-zinc-800 ${
                          r.verdict === "Rejected" ? "opacity-50" : ""
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <span className="text-lg font-semibold text-zinc-600 w-8 shrink-0">#{r.rank}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-4 mb-2">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-zinc-200">{r.model}</h4>
                                  <p className="text-xs text-zinc-500 mt-1">{r.explanation}</p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="text-center">
                                    <div className="text-sm font-semibold text-green-400">
                                      {(r.criticalDetectionRate * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-xs text-zinc-600">Det</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-sm font-semibold text-red-400">
                                      {(r.hallucinationRate * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-xs text-zinc-600">Hall</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-sm font-semibold text-blue-400">
                                      {(r.helpfulnessRate * 100).toFixed(0)}%
                                    </div>
                                    <div className="text-xs text-zinc-600">Help</div>
                                  </div>
                                  <span
                                    className={`text-xs px-2 py-1 rounded font-medium ${
                                      r.verdict === "Acceptable"
                                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                        : r.verdict === "Recommended"
                                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                                    }`}
                                  >
                                    {r.verdict}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <div
                                  className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1"
                                  onClick={() => setExpandedPrompt(expandedPrompt === r.promptId ? null : r.promptId)}
                                >
                                  <span>System Prompt</span>
                                  <svg
                                    className={`w-3 h-3 transition-transform ${expandedPrompt === r.promptId ? "rotate-180" : ""}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                                <AnimatePresence>
                                  {expandedPrompt === r.promptId ? (
                                    <motion.pre
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="mt-2 p-3 bg-zinc-950 rounded-lg text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed border border-zinc-800 overflow-hidden"
                                    >
                                      {r.promptContent}
                                    </motion.pre>
                                  ) : (
                                    <p className="text-xs text-zinc-500 mt-1 font-mono line-clamp-1">
                                      {r.promptContent.slice(0, 80)}...
                                    </p>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(3)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Adjust Focus
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  Start Over
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
