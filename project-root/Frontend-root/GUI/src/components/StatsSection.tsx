import React from "react";
import type { Stats } from "../types";

interface Props { stats: Stats; onResetStats: () => void }

const StatsSection: React.FC<Props> = ({ stats, onResetStats }) => {
  const topics = Object.keys(stats);

  return (
    <div className="stats-section">
      <div className="stats-header">
        <h3>文法要素別 正答率</h3>
        <button className="reset-stats-button" onClick={onResetStats}>リセット</button>
      </div>

      {topics.length === 0 ? (
        <p className="no-stats">データがまだありません。</p>
      ) : (
        <div className="stats-grid">
          {topics.map((topic) => {
            const s = stats[topic];
            const rate = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(0) : "0";
            return (
              <div key={topic} className="stat-card">
                <div className="stat-topic">{topic}</div>
                <div className="stat-bar-container">
                  <div className="stat-bar" style={{ width: `${rate}%` }}></div>
                </div>
                <div className="stat-numbers">
                  <span>{rate}%</span>
                  <small>({s.correct}/{s.total})</small>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StatsSection;
