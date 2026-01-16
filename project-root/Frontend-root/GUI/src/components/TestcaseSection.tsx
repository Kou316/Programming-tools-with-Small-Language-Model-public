import React from "react";
import type { ScbTestcase } from "../types";

interface Props {
  testcases: ScbTestcase[];
  text: string;
  onChange: (raw: string) => void;
  onBlur?: () => void;
}

const TestcaseSection: React.FC<Props> = ({ testcases, text, onChange, onBlur }) => {
  const displayText = text ?? (testcases && testcases.length ? JSON.stringify(testcases, null, 2) : "");

  return (
    <div className="testcase-section">
      <div className="testcase-header">
        <h3>SC2生成 テストケース</h3>
        <button
          onClick={() => navigator.clipboard.writeText(displayText)}
          className="copy-button"
        >
          コピー
        </button>
      </div>
      <textarea
        className="output-editor"
        value={displayText}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder="ここにSC2によって生成されたテストケースが表示されます..."
      />
    </div>
  );
};

export default TestcaseSection;
