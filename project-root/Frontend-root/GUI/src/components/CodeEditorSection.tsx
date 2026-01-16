import React, { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Language } from "../types";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { oneDark } from "@uiw/react-codemirror";

interface Props {
  code: string;
  setCode: Dispatch<SetStateAction<string>>;
  language: Language;
  onSubmit: () => void;
  onCopy: () => void;
}

const CodeEditorSection: React.FC<Props> = ({ code, setCode, language, onSubmit, onCopy }) => {
  const extensions = useMemo(() => {
    switch (language) {
      case "python": return [python()];
      case "c":
      case "cpp": return [cpp()];
      case "java": return [java()];
      default: return [];
    }
  }, [language]);

  return (
    <div className="editor-section">
      <div className="editor-header">
        <div className="header-left">
          <h2>コードエディタ</h2>
          <span className="current-lang-badge">{language.toUpperCase()}</span>
        </div>
        <button className="copy-btn-small" onClick={onCopy}>コピー</button>
      </div>

      <div className="editor-wrapper">
        <CodeMirror
          value={code}
          height="400px"
          theme={oneDark}
          extensions={extensions}
          onChange={(value) => setCode(value)}
          className="cm-editor"
        />
      </div>

      <div className="editor-footer">
        <button className="grade-button" onClick={onSubmit}>採点する (Docker)</button>
      </div>
    </div>
  );
};

export default CodeEditorSection;
