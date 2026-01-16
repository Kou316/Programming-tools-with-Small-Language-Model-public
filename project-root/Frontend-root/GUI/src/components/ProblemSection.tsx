import React from "react";
import type { Language } from "../types";

interface Props {
  problem: string;
  loading: boolean;
  topics: string[];
  difficulties: string[];
  algorithmTopics?: Set<string> | string[];
  selectedTopic: string;
  setSelectedTopic: (t: string) => void;
  selectedDifficulty: string;
  setSelectedDifficulty: (d: string) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  onNextProblem: () => void;
  onReviewProblem?: () => void;
}

const ProblemSection: React.FC<Props> = ({
  problem,
  loading,
  topics,
  difficulties,
  algorithmTopics,
  selectedTopic,
  setSelectedTopic,
  selectedDifficulty,
  setSelectedDifficulty,
  language,
  setLanguage,
  onNextProblem,
  onReviewProblem,
}) => {
  const algoSet = React.useMemo(() => {
    if (!algorithmTopics) return new Set<string>();
    return algorithmTopics instanceof Set ? algorithmTopics : new Set<string>(algorithmTopics);
  }, [algorithmTopics]);

  const handleSelect = (topic: string, diff: string) => {
    setSelectedTopic(topic);
    setSelectedDifficulty(diff);
  };

  const getButtonLabel = () => {
    if (selectedTopic === "auto") return "自動（苦手優先）";
    return `${selectedTopic} - ${selectedDifficulty}`;
  };

  return (
    <div className="problem-section">
      <div className="problem-controls-header">
        <div className="custom-dropdown">
          <button className="dropdown-trigger">
            <span className="label">出題範囲:</span> {getButtonLabel()} <span className="arrow">▼</span>
          </button>
          <div className="dropdown-menu">
            <div
              className="dropdown-item"
              onClick={() => {
                setSelectedTopic("auto");
                setSelectedDifficulty("auto");
              }}
            >
              自動（苦手分野を優先）
            </div>
            {topics.map((topic) => (
              <div key={topic} className="dropdown-item has-submenu">
                <span>{topic}</span>
                <span className="right-arrow">▶</span>
                <div className="dropdown-submenu">
                  {(algoSet.has(topic) ? ["標準"] : difficulties).map((diff) => (
                    <div
                      key={diff}
                      className="submenu-item"
                      onClick={() => handleSelect(topic, diff)}
                    >
                      {diff}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="language-selector">
          <label>言語:</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="python">Python</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>
        </div>

        <button className="generate-problem-button" onClick={onNextProblem} disabled={loading}>
          {loading ? "生成中..." : "問題生成"}
        </button>
        {onReviewProblem && (
          <button className="generate-problem-button secondary" onClick={onReviewProblem} disabled={loading}>
            復習から出題
          </button>
        )}
      </div>

      <div className="problem-display-box">
        {loading ? (
          <div className="loading-text">
            <div className="spinner"></div>
            <p>AIが問題を生成しています...</p>
          </div>
        ) : (
          <div className="problem-content">
            {problem ? (
              <>
                <div className="problem-label">【問題】</div>
                <p>{problem}</p>
              </>
            ) : (
              <p className="placeholder-text">上のメニューから文法と難易度を選び、「問題生成」を押してください。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProblemSection;
