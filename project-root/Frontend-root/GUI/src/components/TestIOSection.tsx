import React from "react";

interface Props {
  testInput: string;
  setTestInput: (value: string) => void;
  testOutput: string;
  onRunLocal: () => void;
}

const TestIOSection: React.FC<Props> = ({ testInput, setTestInput, testOutput, onRunLocal }) => {
  return (
    <div className="test-io-section">
      <div className="test-io-grid">
        <div className="io-column">
          <h3>自由入力 (Input)</h3>
          <textarea className="io-editor" placeholder="入力値をここに入力..." value={testInput} onChange={(e) => setTestInput(e.target.value)} />
        </div>
        <div className="io-column">
          <h3>実行結果 (Output)</h3>
          <textarea className="io-editor result" value={testOutput} readOnly placeholder="実行ボタンを押すと結果が表示されます..." />
        </div>
      </div>
      <div className="io-footer">
        <button onClick={onRunLocal} className="run-manual-button">実行 (自由入力でテスト)</button>
      </div>
    </div>
  );
};

export default TestIOSection;
