"""Check SiteKeeper's Duo flow YAML against GitLab ai-assist's own models.

Runs ai-assist's real json_schema_to_pydantic converter on each inline
response schema, and checks every component / prompt / router key against the
field sets read from ai-assist's v1 source (duo_workflow_service/agent_platform/
v1: flow_config.py, components/agent/component.py, routers/, graph_builder.py).
Tool names are checked against the names in duo_workflow_service/tools.

    git clone --depth 1 --filter=blob:none --sparse       https://gitlab.com/gitlab-org/modelops/applied-ml/code-suggestions/ai-assist.git aia
    git -C aia sparse-checkout set ai_gateway/response_schemas duo_workflow_service/tools
    AIA=aia uv run --no-project --python 3.12       --with jsonschema,structlog,pydantic,pyyaml,langchain-core       scripts/check_duo_flows.py .gitlab/duo/flows/*.yml

Exit 0 = every flow passes. It is not GitLab's full dry-run validator (that
needs the whole ai-assist service installed), so registering the flow in
AI > Flows stays the final word.
"""
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

AIA = Path(os.environ.get("AIA", "aia"))
_stub = Path(tempfile.mkdtemp()) / "ai_gateway" / "response_schemas"
_stub.mkdir(parents=True)
(_stub.parent / "__init__.py").write_text("")
(_stub / "__init__.py").write_text("")
for _name in ("base.py", "converter.py"):
    shutil.copy(AIA / "ai_gateway" / "response_schemas" / _name, _stub / _name)
sys.path.insert(0, str(_stub.parent.parent))
TOOLS = set()
for _py in (AIA / "duo_workflow_service" / "tools").rglob("*.py"):
    TOOLS |= set(re.findall(r'^\s+name(?:: str)? = "([a-z_0-9]+)"', _py.read_text(encoding="utf-8"), re.M))

import yaml
from ai_gateway.response_schemas.converter import json_schema_to_pydantic

TOP = {"flow", "components", "routers", "environment", "version", "prompts",
       "response_schemas", "name", "description", "product_group"}
TOP_REQ = {"flow", "components", "routers", "environment", "version"}
AGENT = {"name", "type", "inputs", "prompt_id", "prompt_version", "toolset",
         "compaction", "response_schema_id", "response_schema_version",
         "response_schema_tracking", "response_schema_tracking_context",
         "require_tool_approval", "pre_approved_tools", "max_cycles",
         "max_wrap_up_retries", "identical_tool_call_limit", "enable_web_search",
         "ui_log_events", "model_tags", "model_size_preference"}
PROMPT = {"prompt_id", "name", "model", "unit_primitives", "prompt_template",
          "params", "operation_type", "tool_output_security"}
bad = 0
for f in sys.argv[1:]:
    cfg = yaml.safe_load(Path(f).read_text(encoding="utf-8"))
    errs = []
    errs += [f"top: unknown {k}" for k in set(cfg) - TOP]
    errs += [f"top: missing {k}" for k in TOP_REQ - set(cfg)]
    if cfg.get("environment") not in ("ambient", "chat", "chat-partial"):
        errs.append("environment")
    names = {c["name"] for c in cfg["components"]}
    prompts = {p["prompt_id"] for p in cfg.get("prompts") or []}
    schemas = {}
    for s in cfg.get("response_schemas") or []:
        extra = set(s) - {"schema_id", "definition"}
        if extra:
            errs.append(f"schema {s['schema_id']}: unknown {extra}")
        try:
            model = json_schema_to_pydantic(s["definition"])
            schemas[s["schema_id"]] = list(model.model_fields)
        except Exception as e:  # noqa: BLE001
            errs.append(f"schema {s['schema_id']}: {e}")
    for c in cfg["components"]:
        if c.get("type") != "AgentComponent":
            continue
        errs += [f"{c['name']}: unknown {k}" for k in set(c) - AGENT]
        errs += [f"{c['name']}: unknown tool {t}" for t in c.get("toolset", []) if t not in TOOLS]
        if c["prompt_id"] not in prompts:
            errs.append(f"{c['name']}: prompt {c['prompt_id']} not defined")
        rs = c.get("response_schema_id")
        if rs and rs not in schemas:
            errs.append(f"{c['name']}: schema {rs} not defined")
        for i in c.get("inputs", []):
            src = i["from"] if isinstance(i, dict) else i
            if not src.startswith("context:"):
                errs.append(f"{c['name']}: input {src}")
    for p in cfg.get("prompts") or []:
        errs += [f"prompt {p['prompt_id']}: unknown {k}" for k in set(p) - PROMPT]
        if set(p["prompt_template"]) - {"system", "user", "placeholder"}:
            errs.append(f"prompt {p['prompt_id']}: template keys")
    for r in cfg["routers"]:
        targets = [r["to"]] if "to" in r else list(r["condition"]["routes"].values())
        for t in [r["from"], *targets]:
            if t not in names | {"end", "abort"}:
                errs.append(f"router: unknown component {t}")
        if "condition" in r:
            path = r["condition"]["input"].split(":", 1)[1].split(".")
            comp = next(c for c in cfg["components"] if c["name"] == path[0])
            fields = schemas.get(comp.get("response_schema_id"), [])
            if len(path) == 3 and path[2] not in fields:
                errs.append(f"router: {path[2]} not in {comp['name']} schema {fields}")
    if cfg["flow"]["entry_point"] not in names:
        errs.append("entry_point")
    print(Path(f).name, "OK" if not errs else errs, "schemas:", schemas)
    bad += bool(errs)
sys.exit(bad)
