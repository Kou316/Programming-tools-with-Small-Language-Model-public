from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import uuid
import re
import json
import os
from pathlib import Path
from typing import Any, Dict, List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CodeRequest(BaseModel):
    language: str
    code: str
    input_data: str = ""
    testcases: List[Dict[str, Any]] | List[str] | None = None


class ProblemEntry(BaseModel):
    topic: Any
    difficulty: Any
    problem_text: str
    source: str | None = None


def fix_java_class_name(code: str, class_name: str = "Main") -> str:
    return re.sub(r"public\s+class\s+\w+", f"public class {class_name}", code)


def run_in_sandbox(cmd: list[str], stdin_text: str, timeout: float = 5.0):
    """ サンドボックス内でのタイムアウト処理を用いたコマンド処理 """
    base_cmd = ["docker", "exec", "-i", "sandbox"]
    try:
        proc = subprocess.run(
            base_cmd + cmd,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        return {
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "exitCode": proc.returncode,
            "timeout": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": e.stdout or "",
            "stderr": (e.stderr or "") + "\n[timeout]",
            "exitCode": 124,
            "timeout": True,
        }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": str(e),
            "exitCode": 1,
            "timeout": False,
        }


def write_file_to_sandbox(path: str, content: str):
    """ /codeを用いたサンドボックス内でのコード記述 """
    result = subprocess.run(
        ["docker", "exec", "-i", "sandbox", "tee", path],
        input=content,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        return False, result.stderr or result.stdout
    return True, ""


def append_problem_to_file(entry: ProblemEntry, path: Path) -> tuple[bool, str]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            line = json.dumps(entry.model_dump(), ensure_ascii=False)
            f.write(line + "\n")
        return True, ""
    except Exception as e:
        return False, str(e)


def append_jsonl_record(obj: dict, path: Path) -> tuple[bool, str]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        return True, ""
    except Exception as e:
        return False, str(e)


@app.post("/run")
def run_code(req: CodeRequest):

    print("DEBUG RAW INPUT =", repr(req.input_data))

    file_id = str(uuid.uuid4())
    temp_dir = "/code"
    language = req.language

    if language == "python":
        fname = f"{file_id}.py"
        compile_cmd = None
        run_cmd = ["python3", fname]
        code_text = req.code

    elif language == "c":
        fname = f"{file_id}.c"
        compile_cmd = ["gcc", fname, "-o", file_id]
        run_cmd = [f"./{file_id}"]
        code_text = req.code

    elif language == "cpp":
        fname = f"{file_id}.cpp"
        compile_cmd = ["g++", fname, "-o", file_id]
        run_cmd = [f"./{file_id}"]
        code_text = req.code

    elif language == "java":
        class_name = "Main"
        fname = f"{class_name}.java"
        compile_cmd = ["javac", fname]
        run_cmd = ["java", class_name]
        code_text = fix_java_class_name(req.code, class_name)

    else:
        return {"error": f"Unsupported language: {language}"}

    #  コンテナ内の/code に書き込み
    file_path = f"{temp_dir}/{fname}"
    ok, err = write_file_to_sandbox(file_path, code_text)
    if not ok:
        return {
            "error": f"failed to write code to sandbox: {err}",
            "stderr": err,
            "stdout": "",
            "exitCode": 1,
        }

    base_cmd = ["docker", "exec", "-i", "sandbox"]

    # コンパイル
    if compile_cmd:
        comp = run_in_sandbox(compile_cmd, "")
        if comp.get("exitCode", 0) != 0:
            return {
                "compileError": comp.get("stderr", "") or comp.get("stdout", ""),
                "stdout": comp.get("stdout", ""),
                "stderr": comp.get("stderr", ""),
                "exitCode": comp.get("exitCode", 1),
            }

    # テストケース処理
    if req.testcases:
        results = []

        for tc in req.testcases:
            case_input = ""
            if isinstance(tc, dict):
                case_input = str(tc.get("input", ""))
            else:
                case_input = str(tc)

            raw_input = case_input.rstrip("\n") + "\n"
            res = run_in_sandbox(run_cmd, raw_input)

            expected_output = ""
            if isinstance(tc, dict):
                expected_output = str(tc.get("output", ""))

            results.append({
                "input": case_input,
                "expected": expected_output,
                "stdout": res.get("stdout", ""),
                "stderr": res.get("stderr", ""),
                "exitCode": res.get("exitCode", 0),
            })

        return results

    # 手動実行
    raw_input = req.input_data.rstrip("\n") + "\n"
    res = run_in_sandbox(run_cmd, raw_input)

    if res.get("timeout"):
        return {
            "error": "Execution timed out",
            "stdout": res.get("stdout", ""),
            "stderr": res.get("stderr", ""),
            "exitCode": res.get("exitCode", 124),
        }

    return {
        "output": res.get("stdout", ""),
        "stderr": res.get("stderr", ""),
        "exitCode": res.get("exitCode", 0),
    }


@app.post("/problems")
def save_problem(entry: ProblemEntry):
    # problems_file.jsonlに生成した問題を保存
    problems_path = Path("/app/problems/problems_file.jsonl")
    ok, err = append_problem_to_file(entry, problems_path)
    if not ok:
        return {"success": False, "error": err}
    return {"success": True}


@app.post("/code_eval")
def save_code_eval(payload: Dict[str, Any]):
    """Append a generic JSON record produced by SC2 (code + testcases + raw_response)
    to a JSONL file that the frontend can fetch (public/code_eval.jsonl).
    """
    # Write to /app/problems so the file is available on the host via the mounted folder
    code_eval_path = Path("/app/problems/code_eval.jsonl")
    ok, err = append_jsonl_record(payload, code_eval_path)
    if not ok:
        return {"success": False, "error": err}
    return {"success": True}
