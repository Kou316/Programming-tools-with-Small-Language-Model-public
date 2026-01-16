import React, { useState, useEffect } from "react";

interface Props {
  answer: string;
  onGenerate: () => void;
  /** when true, show the answer panel automatically whenever `answer` changes */
  autoOpen?: boolean;
}

const AnswerSection: React.FC<Props> = ({ answer, onGenerate, autoOpen = false }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (autoOpen && answer) setIsVisible(true);
  }, [answer, autoOpen]);

  return (
    <div className="answer-section">
      <div className="answer-controls-bar">
        <h3>模範解答 (SC2)</h3>
        <div className="answer-buttons-group">
          <button className="toggle-answer-button" onClick={() => setIsVisible(!isVisible)}>
            {isVisible ? "解答を隠す" : "解答を表示"}
          </button>
          <button className="regen-answer-button" onClick={() => { setIsVisible(true); onGenerate(); }}>
            別解を生成
          </button>
        </div>
      </div>

      {isVisible && (
        <div className="answer-content-area">
          <div className="answer-tools">
            <button className="copy-button-small" onClick={() => navigator.clipboard.writeText(answer)}>コードをコピー</button>
          </div>
          <textarea className="answer-editor" value={answer} readOnly placeholder="ここにSC2が生成した解答コードが表示されます..." />
        </div>
      )}
    </div>
  );
};

export default AnswerSection;
