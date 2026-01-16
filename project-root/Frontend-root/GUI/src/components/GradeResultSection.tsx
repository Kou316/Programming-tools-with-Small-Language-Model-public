import React from "react";
import type { GradeResult, GradeDetail } from "../types";

interface Props {
  result: GradeResult;
  message: string;
  details: GradeDetail[];
}

const getResultClass = (result: GradeResult) => {
  switch (result) {
    case "Correct": return "result-correct";
    case "Wrong": return "result-wrong";
    case "Error": return "result-error";
    default: return "result-pending";
  }
};

const GradeResultSection: React.FC<Props> = ({ result, message, details }) => {
  return (
    <div className="grade-result-section">
      <div className={`result-badge ${getResultClass(result)}`}>
        {result === "Pending" ? "待機中" : result}
      </div>
      <div className="result-detail-box">
        <pre>{message || "採点結果がここに表示されます..."}</pre>
      </div>
      {details.length > 0 && (
        <div className="result-detail-list">
          {details.map((detail, index) => (
            <div
              key={index}
              className={`result-detail-item ${detail.passed ? "detail-pass" : "detail-fail"}`}
            >
              <div className="result-detail-heading">
                {`テストケース ${index + 1} - ${detail.passed ? "PASS" : "FAIL"}`}
              </div>
              <pre className="detail-pre">{`入力:\n${detail.input || "(空)"}\n\n期待値:\n${detail.expected || "(空)"}\n\n出力:\n${detail.stdout || "(空)"}`}</pre>
              {detail.stderr && (
                <pre className="detail-pre stderr">{`stderr:\n${detail.stderr}`}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GradeResultSection;
