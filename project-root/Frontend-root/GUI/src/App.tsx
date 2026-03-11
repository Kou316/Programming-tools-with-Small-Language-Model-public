import React, { useCallback, useEffect, useState } from "react";

import "./styles.css";
import type { Language, ScbTestcase, Stats, GradeResult, GradeDetail, ProblemRecord, WrongEntry } from "./types";

import ProblemSection from "./components/ProblemSection";
import TestcaseSection from "./components/TestcaseSection";
import CodeEditorSection from "./components/CodeEditorSection";
import GradeResultSection from "./components/GradeResultSection";
import TestIOSection from "./components/TestIOSection";
import AnswerSection from "./components/AnswerSection";
import StatsSection from "./components/StatsSection";


const LS_KEY = "difficultyStats_v4";
const LS_SEEN = "seenProblems_v1";
const LS_WRONG = "wrongProblems_v1";
const COLAB_API = (import.meta.env.VITE_COLAB_API_URL ?? "").trim() || "http://localhost:9000";
const PROBLEMS_URL =  (import.meta.env.VITE_PROBLEMS_URL ?? "").trim() ||  new URL("../problems/problems_file.jsonl", import.meta.url).href;
const CODE_EVAL_URL = (import.meta.env.VITE_CODE_EVAL_URL ?? "").trim() || "/code_eval.jsonl";
const LOCAL_SAVE_URL = (import.meta.env.VITE_LOCAL_SAVE_URL ?? "").trim() || "";
const DIFFICULTY_TO_ID: Record<string, number> = { "標準": 1, "応用": 2 };
const ID_TO_DIFFICULTY: Record<number, string> = { 1: "標準", 2: "応用" };

const coerceString = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
};

const cleanBlock = (text: string): string => {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim() !== "---")
    .join("\n")
    .trim();
};

const cleanExpected = (text: string): string => {
  const cleaned = cleanBlock(text);
  return cleaned.replace(/^期待値\s*[:：]\s*/u, "").trim();
};

const normalizeOutput = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");
};

const normalizeProblemText = (text: string): string => {
  if (!text) return "";
  const trimmed = text.trim();
  const idx = trimmed.indexOf("【問題文】");
  if (idx >= 0) {
    return trimmed.slice(idx + "【問題文】".length).trim();
  }
  return trimmed;
};

const simpleId = (topic: string, difficulty: number, body: string): string => {
  const base = `${topic}|${difficulty}|${body}`;
  try {
    const buffer = new TextEncoder().encode(base);
    let hash = 0;
    buffer.forEach((b) => {
      hash = (hash * 31 + b) >>> 0;
    });
    return `p_${hash.toString(16)}`;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
};

const pickRandom = <T,>(arr: T[]): T | null => {
  if (!arr.length) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx];
};

const storageSet = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    
  }
};

const makeKey = (topic: string, difficulty: string | number) => `${topic}|${difficulty}`;

const formatTestcases = (items: ScbTestcase[]): string => {
  if (!items || items.length === 0) return "";
  return items
    .map((tc, idx) => {
      const input = coerceString(tc.input ?? "").trim();
      const output = coerceString(tc.output ?? "").trim();
      return [
        `#${idx + 1}`,
        input ? `入力: ${input}` : "入力:",
        output ? `出力: ${output}` : "出力:",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
};

const formatProblemOutput = (p: ProblemRecord): string => {
  const blocks: string[] = [];
  const add = (label: string, value?: string) => {
    const text = value?.toString().trim();
    if (text) blocks.push(`【${label}】\n${text}`);
  };
  add("問題文", normalizeProblemText(p.problem_text ?? ""));
  add("入力", p.input_spec);
  add("出力", p.output_spec);
  add("入力例", p.example_input);
  add("出力例", p.example_output);
  return blocks.join("\n\n");
};

const normalizeTestcases = (raw: unknown): ScbTestcase[] => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const nested = obj.cases ?? obj.testcases ?? obj.tests;
    if (nested) return normalizeTestcases(nested);
  }

  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const input = coerceString((entry as Record<string, unknown>).input);
          const output = coerceString((entry as Record<string, unknown>).output);
          return { input, output };
        }
        const text = coerceString(entry);
        return { input: text, output: "" };
      })
      .filter((tc) => tc.input !== "" || tc.output !== "");
  }

  if (typeof raw !== "string") return [];

  let text = raw
    .replace(/```[a-zA-Z0-9]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n");

  text = text.replace(/^\s*#\s*\d+\s*$/gm, "");

  const cutMarkers = [
    "Extracted codes count",
    "Calling judge",
  ];
  for (const mk of cutMarkers) {
    const idx = text.indexOf(mk);
    if (idx >= 0) text = text.slice(0, idx);
  }

  const testcaseMarkers = ["【テストケース】", "テストケース", "Test cases", "Test case"];
  for (const mk of testcaseMarkers) {
    const idx = text.indexOf(mk);
    if (idx >= 0) {
      text = text.slice(idx);
      break;
    }
  }

  const results: ScbTestcase[] = [];
  const addCase = (inputRaw: string, outputRaw: string) => {
    const input = cleanBlock(coerceString(inputRaw));
    const output = cleanExpected(coerceString(outputRaw));
    if (input || output) results.push({ input, output });
  };

  const casePattern = /---\s*テストケース\s*\d+\s*---([\s\S]*?)(?=(?:\n---\s*テストケース\s*\d+\s*---)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = casePattern.exec(text)) !== null) {
    const block = match[1];
    const inputMatch = block.match(/入力:\s*([\s\S]*?)(?=\n期待される出力:|$)/);
    const outputMatch = block.match(/期待される出力:\s*([\s\S]*)/);
    addCase(inputMatch ? inputMatch[1] : "", outputMatch ? outputMatch[1] : "");
  }
  if (results.length > 0) return results;

  const ioPatternJa = /入力[:：]\s*([\s\S]*?)\n出力[:：]\s*([\s\S]*?)(?=\n(?:入力[:：]|$))/g;
  while ((match = ioPatternJa.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const jaBracketPattern = /【入力例】\s*([\s\S]*?)\n【出力例】\s*([\s\S]*?)(?=\n【入力例】|$)/g;
  while ((match = jaBracketPattern.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const examplePattern = /入力例?\s*\d*[:：]\s*([\s\S]*?)\n出力例?\s*\d*[:：]\s*([\s\S]*?)(?=\n(?:入力例|Input)|$)/g;
  while ((match = examplePattern.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const mdCasePattern = /テストケース\s*\d+[^\n]*?```[\s\S]*?\n([\s\S]*?)```[\s\S]*?期待される出力[\s\S]*?```[\s\S]*?\n([\s\S]*?)```/g;
  while ((match = mdCasePattern.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const enPattern = /Test\s*case\s*\d+[:：]?\s*[\r\n]+Input[:：]\s*([\s\S]*?)\n(?:Expected\s+)?Output[:：]\s*([\s\S]*?)(?=\n(?:Test\s*case|Input|$))/gi;
  while ((match = enPattern.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const simpleEnPattern = /Input\s*\d*[:：]\s*([\s\S]*?)\n(?:Expected\s+)?Output\s*\d*[:：]\s*([\s\S]*?)(?=\nInput\s*\d*|$)/gi;
  while ((match = simpleEnPattern.exec(text)) !== null) {
    addCase(match[1], match[2]);
  }
  if (results.length > 0) return results;

  const fallback = coerceString(raw);
  return fallback ? [{ input: fallback, output: "" }] : [];
};

const extractApiResponse = (data: any): { code: string; testcases: ScbTestcase[]; raw: string } => {
  let code = "";
  let tests: ScbTestcase[] = [];
  let raw = "";
  let originalRawCandidate: string | null = null;

  const tryParseJsonString = (s: string | undefined): any | null => {
    if (!s || typeof s !== "string") return null;

    try {
      return JSON.parse(s);
    } catch {
      
    }

    const candidates: string[] = [];
    const starts: number[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{" || s[i] === "[") starts.push(i);
    }
    for (const start of starts) {
      for (let end = s.length - 1; end > start; end--) {
        if ((s[start] === "{" && s[end] === "}") || (s[start] === "[" && s[end] === "]")) {
          const cand = s.slice(start, end + 1);
          candidates.push(cand);
        }
      }
    }

    candidates.sort((a, b) => b.length - a.length);
    for (const cand of candidates) {
      try {
        return JSON.parse(cand);
      } catch {
        
      }
    }

    return null;
  };

  try {
    if (data == null) return { code: "", testcases: [], raw: "" };

    if (typeof data === "string") {
      originalRawCandidate = data;
      const parsed = tryParseJsonString(data);
      if (parsed) data = parsed;
    }

    if (Array.isArray(data) && data.length > 0) {
      data = data[0];
    }

    if (typeof data?.raw_response === "string" && data.raw_response.trim()) {
      if (!originalRawCandidate) originalRawCandidate = data.raw_response;
      const parsed = tryParseJsonString(data.raw_response);
      if (parsed) {
        const isRelevant = parsed && typeof parsed === "object" && (
          parsed.code || parsed.code_text || parsed.test_cases || parsed.testcases || parsed.tests || parsed.cases
        );
        if (isRelevant) data = parsed;
        else data = { ...data, ...parsed };
      }
    }

    if ((!data || Object.keys(data).length === 0) && typeof data?.text === "string") {
      if (!originalRawCandidate) originalRawCandidate = data.text;
      const parsed = tryParseJsonString(data.text);
      if (parsed) {
        const isRelevant = parsed && typeof parsed === "object" && (
          parsed.code || parsed.code_text || parsed.test_cases || parsed.testcases || parsed.tests || parsed.cases
        );
        if (isRelevant) data = parsed;
        else data = { ...data, ...parsed };
      }
    }

    code = coerceString(data?.code ?? data?.code_text ?? data?.formatted_output ?? data?.generated_text ?? data?.output ?? data?.answer ?? data?.solution ?? "");

    if ((!code || code.trim() === "") && Array.isArray(data?.choices)) {
      const texts: string[] = [];
      for (const ch of data.choices) {
        if (typeof ch === "string") texts.push(ch);
        else if (typeof ch?.text === "string") texts.push(ch.text);
        else if (typeof ch?.message?.content === "string") texts.push(ch.message.content);
        else if (typeof ch?.delta?.content === "string") texts.push(ch.delta.content);
      }
      if (texts.length) code = texts.join("\n\n");
    }

    if ((!code || code.trim() === "") && data?.result) {
      const tryVal = data.result?.output_text ?? data.result?.text ?? data.result?.generated_text ?? data.result;
      if (typeof tryVal === "string") code = tryVal;
    }

    const possibleTests = data?.testcases ?? data?.test_cases ?? data?.tests ?? data?.cases ?? data?.examples ?? null;
    if (possibleTests) {
      tests = normalizeTestcases(possibleTests);
    }

    if (tests.length === 0 || !code) {
      const candidates = [data?.raw ?? data?.raw_text ?? data?.output ?? data?.text ?? data?.content ?? data?.message ?? data?.body].filter(Boolean);
      for (const c of candidates) {
        if (typeof c === "string") {
          const parsed = tryParseJsonString(c);
          if (parsed) {
            if (!code) code = coerceString(parsed.code ?? parsed.code_text ?? parsed.answer ?? parsed.solution ?? "");
            const nt = normalizeTestcases(parsed.testcases ?? parsed.tests ?? parsed.cases ?? parsed.test_cases ?? []);
            if (nt.length) tests = nt;
            if (code && tests.length) break;
          }
        }
      }
    }

    if (originalRawCandidate) raw = originalRawCandidate;
    if (!raw) raw = coerceString(data?.raw ?? data?.raw_text ?? data?.raw_response ?? data?.text ?? "");
  } catch (e) {
    console.warn("extractApiResponse failed:", e);
  }

  const normalizedTests = normalizeTestcases(tests);
  return { code: coerceString(code), testcases: normalizedTests, raw: coerceString(raw) };
};

const TOPICS = [
  "データ型",
  "変数",
  "演算",
  "文字列制御",
  "配列",
  "連想配列",
  "制御_条件分岐",
  "制御構文_ループ処理",
  "関数宣言",
  "選択ソート",
  "単純ソート",
  "挿入ソート",
  "線形探索",
  "スタック",
  "キュー",
  "クイック・マージ・ヒープソート",
  "二分探索",
  "BFS",
  "DFS",
];
const ALGORITHM_TOPICS = new Set<string>([
  "選択ソート",
  "単純ソート",
  "挿入ソート",
  "線形探索",
  "スタック",
  "キュー",
  "クイック・マージ・ヒープソート",
  "二分探索",
  "BFS",
  "DFS",
]);
const DIFFICULTIES = ["標準", "応用"];

const ExercisePage: React.FC = () => {
  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [testcases, setTestcases] = useState<ScbTestcase[]>([]);
  const [testcaseText, setTestcaseText] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [problem, setProblem] = useState("");
  const [problemRaw, setProblemRaw] = useState("");
  const [consoleOutput, setConsoleOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [generationStartAt, setGenerationStartAt] = useState<number | null>(null);
  const [generationDurationMs, setGenerationDurationMs] = useState<number | null>(null);
  const [timeProblemAppendMs, setTimeProblemAppendMs] = useState<number | null>(null);
  const [timeSc2GenMs, setTimeSc2GenMs] = useState<number | null>(null);
  const [timeGradeMs, setTimeGradeMs] = useState<number | null>(null);
  const [timeRunMs, setTimeRunMs] = useState<number | null>(null);
  const [sc2Debug, setSc2Debug] = useState<{ codeLength: number; testsCount: number; raw?: string } | null>(null);
  const [problemDataset, setProblemDataset] = useState<ProblemRecord[]>([]);
  const [datasetReady, setDatasetReady] = useState(false);
  const [currentProblemId, setCurrentProblemId] = useState<string | null>(null);
  const [seenMap, setSeenMap] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(LS_SEEN);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [wrongMap, setWrongMap] = useState<Record<string, WrongEntry[]>>(() => {
    try {
      const raw = localStorage.getItem(LS_WRONG);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  
  const [selectedTopic, setSelectedTopic] = useState<string>("データ型");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("標準");

  const [stats, setStats] = useState<Stats>({});
  const [gradeResult, setGradeResult] = useState<GradeResult>("Pending");
  const [gradeMessage, setGradeMessage] = useState("");
  const [gradeDetails, setGradeDetails] = useState<GradeDetail[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setStats(JSON.parse(raw));
    } catch {
      setStats({});
    }
  }, []);

  const reloadProblemDataset = useCallback(async () => {
    try {
      const res = await fetch(PROBLEMS_URL);
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      const parsed: ProblemRecord[] = lines
        .map((line) => {
          try {
            const obj = JSON.parse(line);
            const pid = obj.id ?? simpleId(obj.topic, obj.difficulty, obj.output_format?.problem_text ?? obj.problem_text ?? "");
            const problemText = obj.output_format?.problem_text ?? obj.problem_text ?? "";
            return {
              id: pid,
              topic: obj.topic,
              difficulty: obj.difficulty,
              problem_text: problemText,
              input_spec: obj.output_format?.input_spec ?? obj.input_spec,
              output_spec: obj.output_format?.output_spec ?? obj.output_spec,
              example_input: obj.output_format?.example_input ?? obj.example_input,
              example_output: obj.output_format?.example_output ?? obj.example_output,
              source: obj.source ?? obj.task_type,
            } as ProblemRecord;
          } catch (e) {
            console.warn("Failed to parse problem line", e);
            return null;
          }
        })
        .filter((p): p is ProblemRecord => Boolean(p) && Boolean(p.problem_text));
      setProblemDataset(parsed);
      setDatasetReady(true);
      setConsoleOutput((msg) => (msg ? msg : "問題データを読み込みました"));
    } catch (e) {
      console.error(e);
      setConsoleOutput("問題データの読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void reloadProblemDataset();
  }, [reloadProblemDataset]);

  const updateStats = (topic: string, isCorrect: boolean) => {
    if (topic === "auto") return; 
    const newStats = { ...stats };
    if (!newStats[topic]) newStats[topic] = { correct: 0, total: 0 };
    
    newStats[topic].total += 1;
    if (isCorrect) newStats[topic].correct += 1;
    
    setStats(newStats);
    localStorage.setItem(LS_KEY, JSON.stringify(newStats));
  };

  const appendSeen = (key: string, problemId: string) => {
    setSeenMap((prev) => {
      const arr = prev[key] ? Array.from(new Set([...prev[key], problemId])) : [problemId];
      const next = { ...prev, [key]: arr };
      storageSet(LS_SEEN, next);
      return next;
    });
  };

  const appendWrong = (key: string, entry: WrongEntry) => {
    setWrongMap((prev) => {
      const exists = prev[key]?.some((e) => e.problemId === entry.problemId);
      const nextList = exists ? prev[key] : [...(prev[key] ?? []), entry];
      const next = { ...prev, [key]: nextList };
      storageSet(LS_WRONG, next);
      return next;
    });
  };

  const rememberWrong = () => {
    if (!currentProblemId || !problem) return;
    const diffId = DIFFICULTY_TO_ID[selectedDifficulty] ?? 0;
    const key = makeKey(selectedTopic, selectedDifficulty);
    appendWrong(key, {
      key,
      problemId: currentProblemId,
      problemText: problem,
      topic: selectedTopic,
      difficulty: diffId,
    });
  };

  const logTiming = (message: string) => {
    console.info(`[Timing] ${message}`);
  };

  const formatMs = (v: number | null) => (v == null ? "-" : `${v.toFixed(0)} ms`);

  const finalizeTiming = (startedAt?: number | null, label?: string) => {
    if (startedAt == null) return;
    const elapsedMs = performance.now() - startedAt;
    setGenerationDurationMs(elapsedMs);
    logTiming(`${label ?? "Generation finished"}: ${elapsedMs.toFixed(0)} ms`);
    return elapsedMs;
  };

  const fetchProblemViaApi = async (topic: string, difficultyLabel: string): Promise<string> => {
    setConsoleOutput(`Elyzaが問題生成中... (${topic} - ${difficultyLabel})`);
    const res = await fetch(`${COLAB_API}/generate_problem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, difficulty: difficultyLabel }),
    });
    const data = await res.json();
    const text = coerceString(data.problem ?? data.problem_text ?? "");
    if (!text) {
      throw new Error("問題文の生成に失敗しました");
    }
    const normalized = normalizeProblemText(text);
    setProblem(normalized);
    setProblemRaw(text);
    setCurrentProblemId(simpleId(topic, DIFFICULTY_TO_ID[difficultyLabel] ?? difficultyLabel, text));
    return text;
  };

  const generateAnswerAndTestcases = async (problemText: string, startedAt?: number | null) => {
    setConsoleOutput("SC2が解答とテストケースを生成中...");
    setTimeSc2GenMs(null);
      const sc2StartedAt = performance.now();
      try {
      const res = await fetch(`${COLAB_API}/generate_code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem_text: problemText,
          language: language,
        }),
      });
      const data = await res.json();
      console.info("[SC2 api_response]", data);

      const extracted = extractApiResponse(data);
      let genCode = extracted.code ?? "";
      let genTests = extracted.testcases ?? [];
      const extractedRaw = extracted.raw ?? String(data?.raw_response ?? "");

      if ((!genCode || String(genCode).trim() === "") && genTests.length === 0) {
        try {
          const sampleRes = await fetch(CODE_EVAL_URL);
          if (sampleRes.ok) {
            const text = await sampleRes.text();
            const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
            if (lines.length > 0) {
              const entry = JSON.parse(lines[lines.length - 1]);
              const fallbackCode = entry.code ?? entry.code_text ?? "";
              const fallbackTests = normalizeTestcases(entry.testcases ?? entry.test_cases ?? entry.tests ?? []);
              if (fallbackCode && String(fallbackCode).trim() !== "") genCode = fallbackCode;
              if (fallbackTests.length > 0) genTests = fallbackTests;
              console.info("[SC2 fallback loaded from code_eval.jsonl]", { fallbackCode: !!fallbackCode, fallbackTestsCount: fallbackTests.length });
            }
          }
        } catch (e) {
          console.warn("Failed to load fallback code_eval.jsonl:", e);
        }
      }

      console.info("[SC2 extracted testcases]", genTests);

      setSc2Debug({ codeLength: genCode ? String(genCode).length : 0, testsCount: genTests.length, raw: extractedRaw });

      setAnswer(genCode);
      setTestcases(genTests);
      setTestcaseText(formatTestcases(genTests));

      try {
          if (COLAB_API) {
          const payload = { code: genCode, testcases: genTests, raw_response: extractedRaw };
          const saveRes = await fetch(`${COLAB_API}/code_eval`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          try {
            const saveJson = await saveRes.json();
            console.info("[Saved code_eval]", saveJson);
          } catch (e) {
            console.info("[Saved code_eval] status", saveRes.status);
          }

          if (LOCAL_SAVE_URL) {
            try {
              const localRes = await fetch(LOCAL_SAVE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              try {
                const localJson = await localRes.json();
                console.info("[Saved code_eval local]", localJson);
              } catch {
                console.info("[Saved code_eval local] status", localRes.status);
              }
            } catch (e) {
              
            }
          }
        }
      } catch (e) {
        console.warn("Failed to save code_eval:", e);
      }
      setTimeSc2GenMs(performance.now() - sc2StartedAt);
      const elapsed = finalizeTiming(startedAt, "問題・解答表示まで");
      const suffix = typeof elapsed === "number" ? ` (${elapsed.toFixed(0)} ms)` : "";
      setConsoleOutput(`問題セットの準備が完了しました。${suffix}`);
      void replenishProblem(selectedTopic, selectedDifficulty);
      return true;
    } catch (err) {
      setConsoleOutput("SC2生成エラー: " + String(err));
      finalizeTiming(startedAt, "問題・解答表示失敗まで");
      return false;
    }
  };

  const selectProblem = (topic: string, difficultyLabel: string, fromReview: boolean): ProblemRecord | null => {
    const diffId = DIFFICULTY_TO_ID[difficultyLabel];
    if (!diffId) {
      alert("難易度の解決に失敗しました");
      return null;
    }
    const key = makeKey(topic, difficultyLabel);
    if (!datasetReady) {
      alert("問題データがまだ読み込まれていません");
      return null;
    }

    if (fromReview) {
      const reviewList = wrongMap[key] ?? [];
      if (!reviewList.length) {
        alert("この組み合わせの復習問題はありません");
        return null;
      }
      const chosen = pickRandom(reviewList);
      if (!chosen) return null;
      const found = problemDataset.find((p) => p.id === chosen.problemId);
      if (found) return found;
      return {
        id: chosen.problemId,
        topic: chosen.topic,
        difficulty: chosen.difficulty,
        problem_text: chosen.problemText,
      } as ProblemRecord;
    }

    const candidates = problemDataset.filter((p) => p.topic === topic && p.difficulty === diffId);
    if (!candidates.length) {
      alert("該当する問題がデータセットにありません");
      return null;
    }
    const seen = new Set(seenMap[key] ?? []);
    const unseen = candidates.filter((p) => !seen.has(p.id));
    const chosen = pickRandom(unseen.length ? unseen : candidates);
    return chosen ?? null;
  };

  const replenishProblem = async (topic: string, difficultyLabel: string) => {
    try {
      setTimeProblemAppendMs(null);
      const appendStartedAt = performance.now();
      const genRes = await fetch(`${COLAB_API}/generate_problem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, difficulty: difficultyLabel }),
      });
      const genData = await genRes.json();
      const newProblemText = genData.problem ?? genData.problem_text;
      if (!newProblemText) return;
      const payload = {
        topic,
        difficulty: DIFFICULTY_TO_ID[difficultyLabel] ?? difficultyLabel,
        problem_text: newProblemText,
        source: "elyza",
      };
      await fetch(`${COLAB_API}/problems`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setTimeProblemAppendMs(performance.now() - appendStartedAt);
      void reloadProblemDataset();
      console.info("[Replenish] 問題を補充しました");
    } catch (e) {
      console.warn("[Replenish] 補充に失敗", e);
    }
  };

  const handleNextProblem = async () => {
    setLoading(true);
    setGenerationDurationMs(null);
    setTimeSc2GenMs(null);
    setTimeProblemAppendMs(null);
    logTiming(`問題取得を開始 (${selectedTopic} / ${selectedDifficulty})`);
    setProblem("");
    setProblemRaw("");
    setCode("");
    setAnswer("");
    setTestcases([]);
    setTestcaseText("");
    setGradeResult("Pending");
    setGradeMessage("");
    setGradeDetails([]);
    setConsoleOutput(`問題データセットから出題を選択中... (${selectedTopic} - ${selectedDifficulty})`);

    try {
      const chosen = selectProblem(selectedTopic, selectedDifficulty, false);
      if (!chosen) {
        setProblem("この組み合わせの問題がデータセットにありません");
        return;
      }

      const formattedProblem = formatProblemOutput(chosen);
      setProblem(formattedProblem);
      setProblemRaw(chosen.problem_text ?? formattedProblem);
      setCurrentProblemId(chosen.id);
      setLoading(false);

      const startedAt = performance.now();
      setGenerationStartAt(startedAt);
      setConsoleOutput("SC2が解答とテストケースを生成中...");

      void generateAnswerAndTestcases(chosen.problem_text ?? formattedProblem, startedAt).catch((err) => {
        setConsoleOutput("SC2生成エラー: " + String(err));
      });
    } catch (err) {
      setProblem("エラー: 問題取得に失敗しました");
      setConsoleOutput(String(err));
      setLoading(false);
    }
  };

  const handleTestcaseTextChange = (raw: string) => {
    setTestcaseText(raw);
    if (!raw.trim()) {
      setTestcases([]);
    }
  };

  const syncTestcasesFromText = (rawText?: string): ScbTestcase[] => {
    const source = rawText ?? testcaseText;
    const trimmed = source.trim();

    if (!trimmed) {
      setTestcases([]);
      if (testcaseText !== "") {
        setTestcaseText("");
      }
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      const normalized = normalizeTestcases(parsed);
      setTestcases(normalized);
      setTestcaseText(formatTestcases(normalized));
      return normalized;
    } catch {
      
    }

    const normalized = normalizeTestcases(source);
    if (normalized.length === 0) {
      return testcases;
    }
    setTestcases(normalized);
    setTestcaseText(formatTestcases(normalized));
    return normalized;
  };

  const handleGrade = async () => {
    if (!code.trim()) {
      alert("コードを入力してください");
      return;
    }
    const currentTestcases = syncTestcasesFromText();
    if (currentTestcases.length === 0) {
      alert("テストケースがありません。問題を生成してください。");
      return;
    }

    setGradeResult("Pending");
    setGradeMessage("Dockerコンテナで採点中...");
    setGradeDetails([]);
    setTimeGradeMs(null);
    const gradeStartedAt = performance.now();
    
    try {
      const res = await fetch(`${COLAB_API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          testcases: currentTestcases, 
        }),
      });
      const data = await res.json();

      if (Array.isArray(data)) {
        if (data.length === 0) {
          setGradeResult("Error");
          setGradeMessage("テストケース結果が返却されませんでした。");
          return;
        }

        const details = data.map((item: any) => {
          const input = coerceString(item?.input ?? "");
          const expectedRaw = coerceString(item?.expected ?? "");
          const stdoutRaw = coerceString(item?.stdout ?? "");
          const stderr = coerceString(item?.stderr ?? "");
          const expected = normalizeOutput(expectedRaw);
          const stdout = normalizeOutput(stdoutRaw);
          const passed = stdout === expected;
          const detail: GradeDetail = { input, expected, stdout, stderr, passed };
          return detail;
        });

        setGradeDetails(details);

        const allPassed = details.every((detail) => detail.passed);
        if (allPassed) {
          setGradeResult("Correct");
          setGradeMessage(`全 ${details.length} ケース正解！`);
          updateStats(selectedTopic, true);
        } else {
          setGradeResult("Wrong");
          setGradeMessage("不正解のテストケースがあります。\n下のログを確認してください。");
          rememberWrong();
          updateStats(selectedTopic, false);
        }
        return;
      }

      const isCorrect = data.passedAll === true;
      const errorMsg = data.error || data.compileError;

      if (errorMsg) {
        setGradeResult("Error");
        setGradeMessage(errorMsg);
      } else if (isCorrect) {
        setGradeResult("Correct");
        setGradeMessage(`全 ${currentTestcases.length} ケース正解！`);
        updateStats(selectedTopic, true);
      } else {
        if (Array.isArray(data?.results)) {
          const details = data.results.map((item: any) => {
            const input = coerceString(item?.input ?? "");
            const expectedRaw = coerceString(item?.expected ?? "");
            const stdoutRaw = coerceString(item?.stdout ?? "");
            const stderr = coerceString(item?.stderr ?? "");
            const expected = normalizeOutput(expectedRaw);
            const stdout = normalizeOutput(stdoutRaw);
            const passed = stdout === expected;
            const detail: GradeDetail = { input, expected, stdout, stderr, passed };
            return detail;
          });
          setGradeDetails(details);
        }

        setGradeResult("Wrong");
        setGradeMessage("不正解のテストケースがあります。\n下のログを確認してください。");
        rememberWrong();
        updateStats(selectedTopic, false);
      }

    } catch (err) {
      setGradeResult("Error");
      setGradeMessage("採点サーバーエラー: " + String(err));
      setGradeDetails([]);
    } finally {
      setTimeGradeMs(performance.now() - gradeStartedAt);
    }
  };

  const handleRunManual = async () => {
    setTestOutput("実行中...");
    setTimeRunMs(null);
    const runStartedAt = performance.now();
    try {
      const res = await fetch(`${COLAB_API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          input_data: testInput,
          testcases: [], 
        }),
      });
      const data = await res.json();
      setTestOutput(data.output ?? data.error ?? data.compileError ?? "出力なし");
    } catch (err) {
      setTestOutput("実行エラー: " + String(err));
    } finally {
      setTimeRunMs(performance.now() - runStartedAt);
    }
  };

  const handleReviewProblem = async () => {
    const startedAt = performance.now();
    setLoading(true);
    setGenerationStartAt(startedAt);
    setGenerationDurationMs(null);
    setTimeSc2GenMs(null);
    setTimeProblemAppendMs(null);
    logTiming(`復習問題を開始 (${selectedTopic} / ${selectedDifficulty})`);

    setProblem("");
    setProblemRaw("");
    setCode("");
    setAnswer("");
    setTestcases([]);
    setTestcaseText("");
    setGradeResult("Pending");
    setGradeMessage("");
    setGradeDetails([]);
    setConsoleOutput(`復習問題を取得中... (${selectedTopic} - ${selectedDifficulty})`);

    try {
      const chosen = selectProblem(selectedTopic, selectedDifficulty, true);
      if (!chosen) {
        setProblem("復習問題がありません");
        return;
      }
      const formattedProblem = formatProblemOutput(chosen);
      setProblem(formattedProblem);
      setProblemRaw(chosen.problem_text ?? "");
      setCurrentProblemId(chosen.id);
      await generateAnswerAndTestcases(chosen.problem_text ?? formattedProblem, startedAt);
    } catch (err) {
      setProblem("エラー: 復習問題の取得に失敗しました");
      setConsoleOutput(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-wrapper">
        <div className="container">
          <h1 className="app-title">Programming</h1>

          <ProblemSection
            problem={problem}
            loading={loading}
            topics={TOPICS}
            difficulties={DIFFICULTIES}
            algorithmTopics={ALGORITHM_TOPICS}
            selectedTopic={selectedTopic}
            setSelectedTopic={setSelectedTopic}
            selectedDifficulty={selectedDifficulty}
            setSelectedDifficulty={setSelectedDifficulty}
            language={language}
            setLanguage={setLanguage}
            onNextProblem={handleNextProblem}
            onReviewProblem={handleReviewProblem}
          />

          <TestcaseSection
            testcases={testcases}
            text={testcaseText}
            onChange={handleTestcaseTextChange}
            onBlur={() => syncTestcasesFromText()}
          />

          <CodeEditorSection
            code={code}
            setCode={setCode}
            language={language}
            onSubmit={handleGrade}
            onCopy={() => navigator.clipboard.writeText(code)}
          />

          <GradeResultSection result={gradeResult} message={gradeMessage} details={gradeDetails} />

          <TestIOSection 
            testInput={testInput}
            setTestInput={setTestInput}
            testOutput={testOutput}
            onRunLocal={handleRunManual}
          />

          <AnswerSection 
            answer={answer} 
            onGenerate={() => generateAnswerAndTestcases(problemRaw || problem)} 
            autoOpen={false}
          />

          {consoleOutput && (
            <div className="console-bar">
              INFO: {consoleOutput}
              {generationDurationMs != null && (
                <span className="console-bar__time"> (生成時間: {generationDurationMs.toFixed(0)} ms)</span>
              )}
            </div>
          )}

            {sc2Debug && (
              <div style={{border: '1px solid #666', padding: 8, marginTop: 8, background: '#111827', color: '#fff'}}>
                <strong>SC2 Debug:</strong>
                <div>コード長: {sc2Debug.codeLength}</div>
                <div>テストケース数: {sc2Debug.testsCount}</div>
                <details style={{color: '#ddd'}}>
                  <summary>raw_response を表示</summary>
                  <pre style={{whiteSpace: 'pre-wrap', color: '#ddd'}}>{sc2Debug.raw}</pre>
                </details>
              </div>
            )}

          <div className="timing-panel">
            <strong>処理時間</strong>
            <div>問題生成→保存: {formatMs(timeProblemAppendMs)}</div>
            <div>SC2コード・テスト生成: {formatMs(timeSc2GenMs)}</div>
            <div>採点リクエスト: {formatMs(timeGradeMs)}</div>
            <div>コード実行: {formatMs(timeRunMs)}</div>
          </div>

          <StatsSection 
            stats={stats} 
            onResetStats={() => {
              setStats({});
              localStorage.removeItem(LS_KEY);
            }} 
          />
        </div>
      </div>
    </>
  );
};

export default ExercisePage;
