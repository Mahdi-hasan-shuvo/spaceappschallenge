"""Astra Vigil 2.0 server: REST + WebSocket replay + static frontend.

All telemetry is SIMULATED. Roles are demo roles (a query parameter), not
authentication; the privacy rules are still enforced server-side so the
browser never receives data its role may not see.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import time
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, privacy
from . import agent
from .assistant import SUGGESTED, ask
from .rehearsal import RehearsalRun
from compute.detect import SIGNALS, Config
from .engine import LEVELS, Mission, load_fixture, load_rehearsal
from .evidence import Evidence
from .store import Store

SIM_LABEL = "SIMULATED DATA"


class AppState:
    def __init__(self, db_path: str, fixture: Optional[dict] = None):
        self.store = Store(db_path)
        self.evidence = Evidence()
        self.cfg = Config()
        fx = fixture or load_fixture(config.FIXTURES / config.VITALS_FILE)
        self.rehearsal_fixture = load_rehearsal(config.FIXTURES / config.REHEARSAL_FILE)
        self.mission = Mission(fx, self.cfg, explain=agent.explain, evidence=self.evidence.for_alert)
        self.delay_key = config.DEFAULT_DELAY
        self.delay_min = config.DELAY_PRESETS[self.delay_key]
        self.speed = 2
        self.acc = 0.0
        self.clients: Dict[WebSocket, dict] = {}
        self.earth_status: Dict[str, dict] = {}     # last DELIVERED status per crew (what Earth knows)
        self.task: Optional[asyncio.Task] = None
        self.validation = json.loads((config.DATA / "validation.json").read_text(encoding="utf-8"))

    # ------------------------------------------------------------- helpers
    def photo_file(self, cid: str) -> Optional[Path]:
        """The portrait for a known crew id, or None. Names are fixed (id + extension): no path from the client."""
        if cid not in self.mission.crew:
            return None
        for ext in config.PHOTO_EXTS:
            p = config.CREW_PHOTOS / f"{cid}{ext}"
            if p.is_file():
                return p
        return None

    def crew_ids(self) -> List[str]:
        return self.mission.crew_ids

    def consented(self, cid: str, role: str) -> bool:
        return self.store.has_consent(cid, role)

    def tier(self, role: str, viewer: Optional[str], cid: str) -> int:
        return privacy.tier_for(role, viewer, cid, self.consented(cid, role))

    def crew_list(self, role: str, viewer: Optional[str]) -> List[dict]:
        lst = privacy.project_crew_list(role, viewer, self.mission.crew_public(), self.store.consents())
        for c in lst:   # a portrait is identity, not health data: the same for every role, like the name
            p = self.photo_file(c["id"])
            c["photo"] = f"/crew-photo/{c['id']}?v={int(p.stat().st_mtime)}" if p else None
        if role == "ground":  # Earth only knows what has been delivered through the outbox
            for c in lst:
                e = self.earth_status.get(c["id"])
                c["status"] = e["status"] if e else "unknown"
                c["level"] = LEVELS.get(c["status"], -1)
                c["as_of_day"] = e["day"] if e else None
        return lst

    def alerts_for(self, role: str, viewer: Optional[str]) -> List[dict]:
        out = []
        if role == "ground":
            return out
        for cid, cs in self.mission.crew.items():
            t = self.tier(role, viewer, cid)
            for a in cs.alerts:
                p = privacy.project_alert(a, t)
                if p:
                    out.append(p)
        return sorted(out, key=lambda a: (a["day"], a["id"]))

    def trends_for(self, role: str, viewer: Optional[str]) -> Dict[str, dict]:
        out = {}
        if self.mission.day < 0:
            return out
        for cid in self.crew_ids():
            if privacy.may_see_trend(role, viewer, cid, self.consented(cid, role)):
                out[cid] = self.mission.trend_summary(cid)
        return out

    def outbox_for(self, role: str) -> List[dict]:
        box = self.store.outbox()
        return [m for m in box if m["delivered"]] if role == "ground" else box

    def snapshot(self, role: str, viewer: Optional[str]) -> dict:
        m = self.mission
        series = None
        if viewer in m.crew and privacy.may_see_series(role, viewer, viewer):
            series = {"crew_id": viewer, "data": m.series(viewer)}
        return {
            "type": "snapshot", "simulated": True, "label": SIM_LABEL, "role": role, "viewer": viewer,
            "server_time": time.time(),
            "day": m.day, "n": m.n, "playing": m.playing, "speed": self.speed,
            "delay": {"key": self.delay_key, "min": self.delay_min,
                      "presets": config.DELAY_PRESETS, "seconds_per_min": config.SECONDS_PER_MIN},
            "crew": self.crew_list(role, viewer),
            "alerts": self.alerts_for(role, viewer),
            "trends": self.trends_for(role, viewer),
            "series": series, "outbox": self.outbox_for(role),
            "consents": self.store.consents(),
            "validation": m.validation_summary() if role in ("crew", "commander") else None,
        }

    # ------------------------------------------------------------ broadcast
    async def _send(self, ws: WebSocket, msg: dict) -> bool:
        try:
            await ws.send_text(json.dumps(msg))
            return True
        except Exception:
            return False

    async def broadcast_snapshots(self) -> None:
        dead = []
        for ws, c in list(self.clients.items()):
            if not await self._send(ws, self.snapshot(c["role"], c["viewer"])):
                dead.append(ws)
        for ws in dead:
            self.clients.pop(ws, None)

    def tick_for(self, role: str, viewer: Optional[str], res: dict, queued: List[dict],
                 delivered: List[dict]) -> dict:
        m = self.mission
        msg = {"type": "tick", "day": res["day"], "playing": m.playing, "speed": self.speed,
               "server_time": time.time(),
               "status": {}, "rows": {}, "alerts": [], "queued": [], "delivered": delivered}
        if role == "ground":
            msg["queued"] = []
            return msg
        msg["queued"] = queued
        msg["status"] = res["status"]
        if viewer in res["rows"] and privacy.may_see_series(role, viewer, viewer):
            msg["rows"] = {viewer: res["rows"][viewer]}
        for a in res["alerts"]:
            p = privacy.project_alert(a, self.tier(role, viewer, a["crew_id"]))
            if p:
                msg["alerts"].append(p)
        if role == "medical" and (res["alerts"] or res["day"] % 5 == 0):
            msg["trends"] = self.trends_for(role, viewer)
        return msg

    async def _broadcast_tick(self, res: dict, queued: List[dict], delivered: List[dict]) -> None:
        dead = []
        for ws, c in list(self.clients.items()):
            if not await self._send(ws, self.tick_for(c["role"], c["viewer"], res, queued, delivered)):
                dead.append(ws)
        for ws in dead:
            self.clients.pop(ws, None)

    # -------------------------------------------------------------- replay
    def _after_step(self, res: dict, prev_status: Dict[str, str]) -> List[dict]:
        """Audit + outbox side effects of one mission day. Returns newly queued messages."""
        queued = []
        for a in res["alerts"]:
            self.store.log("detector", "alert_raised",
                           {"crew": a["crew_id"], "day": a["day"], "rule": a["rule"],
                            "signals": a["signals"]})
        for cid, st in res["status"].items():
            if st != prev_status.get(cid) and st != "learning":
                rule = None
                if st == "alert":
                    last = self.mission.crew[cid].alerts[-1] if self.mission.crew[cid].alerts else None
                    rule = last["rule"] if last else None
                q = self.store.enqueue(cid, st, res["day"], rule, self.delay_min,
                                       config.SECONDS_PER_MIN)
                self.store.log("outbox", "queued", {"crew": cid, "status": st, "day": res["day"],
                                                    "delay_min": self.delay_min})
                queued.append({"id": q["id"], "crew_id": cid, "status": st, "day": res["day"],
                               "rule": rule, "deliver_at": q["deliver_at"],
                               "delay_min": self.delay_min, "delivered": 0,
                               "queued_at": time.time()})
        return queued

    def _deliver(self) -> List[dict]:
        done = self.store.deliver_due()
        for d in done:
            self.earth_status[d["crew_id"]] = {"status": d["status"], "day": d["day"]}
            self.store.log("outbox", "delivered", {"crew": d["crew_id"], "status": d["status"],
                                                   "day": d["day"]})
        return done

    async def step_once(self) -> dict:
        m = self.mission
        prev = dict(m.status_now())
        out = m.advance(1)
        if not out:
            m.playing = False
            return {}
        res = out[0]
        queued = self._after_step(res, prev)
        delivered = self._deliver()
        await self._broadcast_tick(res, queued, delivered)
        return res

    async def loop(self) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(0.05)
            now = time.monotonic()
            dt, last = now - last, now
            m = self.mission
            if m.playing:
                self.acc += dt * self.speed
                n = 0
                while self.acc >= 1.0 and m.playing and n < 5:
                    self.acc -= 1.0
                    n += 1
                    await self.step_once()
                    if not m.playing:
                        await self.broadcast_snapshots()
            else:
                self.acc = 0.0
            done = self._deliver()
            if done:
                msg = {"type": "delivered", "delivered": done, "server_time": time.time()}
                for ws in list(self.clients):
                    await self._send(ws, msg)

    def reset_to(self, day: int) -> None:
        self.mission.reset_to(day)
        self.store.clear_outbox()
        self.earth_status = {}
        self.acc = 0.0
        # a jump replays silently; treat the statuses at that day as already known to Earth
        for cid, st in self.mission.status_now().items():
            if st != "learning":
                self.earth_status[cid] = {"status": st, "day": self.mission.day}


def create_app(db_path: Optional[str] = None, static_dir: Optional[Path] = None,
               fixture: Optional[dict] = None, autostart: bool = True) -> FastAPI:
    state = AppState(db_path or config.DB_PATH, fixture)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        state.store.log("system", "start", {"version": __version__, "simulated": True})
        if autostart:
            state.task = asyncio.create_task(state.loop())
        try:
            yield
        finally:
            if state.task:
                state.task.cancel()

    app = FastAPI(title="Astra Vigil 2.0", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.astra = state

    def need_role(role: str) -> str:
        if role not in privacy.ROLES:
            raise HTTPException(422, f"role must be one of {privacy.ROLES}")
        return role

    def need_crew(cid: str) -> str:
        if cid not in state.mission.crew:
            raise HTTPException(404, "unknown crew member")
        return cid

    # ---------------------------------------------------------------- meta
    @app.get("/api/meta")
    def meta():
        return {
            "name": "Astra Vigil 2.0", "version": __version__, "team": "MANTA",
            "author": "Niloy Bhattacharjee", "license": "Apache-2.0",
            "simulated": True, "label": SIM_LABEL,
            "notice": "All telemetry is simulated. Demo crew: team members' names and photos, invented vitals. Not a medical device. No diagnosis is made.",
            "offline": True, "signals": SIGNALS, "roles": list(privacy.ROLES),
            "config": {"baseline_days": state.cfg.baseline_days, "min_baseline": state.cfg.min_baseline,
                       "single_threshold_sd": state.cfg.single_threshold_sd,
                       "single_persist": state.cfg.single_persist,
                       "multi_threshold_sd": state.cfg.multi_threshold_sd,
                       "multi_window": state.cfg.multi_window,
                       "multi_min_signals": state.cfg.multi_min_signals},
            "speeds": list(config.SPEEDS), "delay_presets": config.DELAY_PRESETS,
            "evidence": state.evidence.meta, "suggested": SUGGESTED,
            "validation": state.validation,
        }

    @app.get("/crew-photo/{cid}")
    def crew_photo(cid: str):
        p = state.photo_file(cid)
        if not p:
            raise HTTPException(404, "no portrait for this crew member (add crew_photos/<id>.jpg)")
        return FileResponse(p, headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/health")
    def health():
        return {"ok": True, "simulated": True, "day": state.mission.day}

    # ---------------------------------------------------------------- state
    @app.get("/api/snapshot")
    def snapshot(role: str = "crew", crew: Optional[str] = None):
        need_role(role)
        return state.snapshot(role, crew)

    @app.get("/api/series/{cid}")
    def series(cid: str, role: str = "crew", viewer: Optional[str] = None):
        need_role(role)
        need_crew(cid)
        if not privacy.may_see_series(role, viewer, cid):
            raise HTTPException(403, "raw numbers are visible only to the crew member themself (tier 0)")
        state.store.log(role, "series_viewed", {"crew": cid})
        return {"simulated": True, "crew_id": cid, "day": state.mission.day,
                "series": state.mission.series(cid)}

    @app.get("/api/trend/{cid}")
    def trend(cid: str, role: str = "medical", viewer: Optional[str] = None):
        need_role(role)
        need_crew(cid)
        if not privacy.may_see_trend(role, viewer, cid, state.consented(cid, role)):
            raise HTTPException(403, "trend view needs the crew member's consent (tier 1)")
        return {"simulated": True, **state.mission.trend_summary(cid)}

    @app.get("/api/alerts")
    def alerts(role: str = "crew", crew: Optional[str] = None):
        need_role(role)
        return {"simulated": True, "alerts": state.alerts_for(role, crew)}

    @app.get("/api/evidence")
    def evidence_catalog():
        return state.evidence.catalog()

    @app.get("/api/rehearsal-fixture")
    def rehearsal_fixture():
        return state.rehearsal_fixture

    def rehearsal_run(which: str) -> RehearsalRun:
        if which not in ("planted", "clean"):
            raise HTTPException(422, "fixture must be 'planted' or 'clean'")
        name = config.REHEARSAL_FILE if which == "planted" else "rehearsal_1hz_clean.json"
        try:
            fx = load_rehearsal(config.FIXTURES / name)
        except FileNotFoundError:
            raise HTTPException(404, f"{name} not found in {config.FIXTURES}")
        return RehearsalRun(fx, explain=agent.explain, evidence=state.evidence.for_alert)

    @app.get("/api/rehearsal/alerts")
    def rehearsal_alerts(fixture: str = "planted"):
        """Run the whole 1 Hz stream through the detector at once (what the websocket will show)."""
        run = rehearsal_run(fixture)
        alerts = run.run_all()
        pa = run.meta.get("planted_anomaly")
        return {"simulated": True, "label": SIM_LABEL, "fixture": fixture, "n": run.n,
                "planted_anomaly": pa, "alerts": alerts,
                "first_alert_index": alerts[0]["index"] if alerts else None,
                "detection_delay_samples": (alerts[0]["index"] - pa["onset_index"]) if alerts and pa else None}

    @app.get("/api/agent")
    def agent_info():
        """Show exactly what the explanation agent is told and allowed to see."""
        return {"mode": "llm+post-check" if agent.DEFAULT_AGENT.llm else "template",
                "system_prompt": agent.SYSTEM_PROMPT,
                "input_whitelist": {"alert": ["rule", "day", "signals", "details[signal,current,baseline_mean,"
                                              "baseline_sd,z,threshold_sd,window_days,baseline_n,"
                                              "consecutive_days,row_unit]"],
                                    "records": ["id", "kind", "title", "url", "summary", "relevance"]},
                "post_check": ["no diagnostic / treatment language (compute.guard)",
                               "no interpretation, cause, prediction or advice words",
                               "no number that is not in the alert object",
                               "no record id or URL that was not supplied",
                               "at least one valid citation",
                               "anything rejected is replaced by the deterministic template"],
                "simulated": True}

    @app.get("/api/evidence/signal/{signal}")
    def evidence_signal(signal: str):
        if signal not in SIGNALS:
            raise HTTPException(404, "unknown signal")
        return {"signal": signal, "cards": state.evidence.for_signal(signal),
                "note": "Context pointers only. They do not prove the rule is clinically meaningful."}

    @app.get("/api/validation")
    def validation():
        return {"simulated": True,
                "note": "Ground truth exists only because the data is simulated.",
                "live": state.mission.validation_summary(), "monte_carlo": state.validation}

    # -------------------------------------------------------------- control
    @app.post("/api/control")
    async def control(body: dict = Body(...)):
        action = body.get("action")
        m = state.mission
        if action == "play":
            if m.day >= m.n - 1:
                state.reset_to(-1)
            m.playing = True
        elif action == "pause":
            m.playing = False
        elif action == "speed":
            sp = int(body.get("value", 1))
            if sp not in config.SPEEDS:
                raise HTTPException(422, f"speed must be one of {config.SPEEDS}")
            state.speed = sp
        elif action in ("seek", "reset"):
            target = -1 if action == "reset" else int(body.get("value", 0))
            was = m.playing
            state.reset_to(target)
            m.playing = was and action == "seek"
        else:
            raise HTTPException(422, "action must be play, pause, speed, seek or reset")
        state.store.log("operator", "control", {"action": action, "value": body.get("value")})
        await state.broadcast_snapshots()
        return {"ok": True, "day": m.day, "playing": m.playing, "speed": state.speed}

    @app.post("/api/step")
    async def step(body: dict = Body(default={})):
        """Advance by hand (used by tests and the 'next day' button)."""
        n = max(1, min(int(body.get("n", 1)), 50))
        last = {}
        for _ in range(n):
            last = await state.step_once() or last
        return {"ok": True, "day": state.mission.day}

    @app.post("/api/jump-to-event")
    async def jump(body: dict = Body(default={})):
        """Rehearse the demo beat: jump to a few days before the first planted event."""
        pl = state.mission.validation_summary()["planted"]
        cid = body.get("crew_id")
        cand = [p for p in pl if (cid is None or p["crew_id"] == cid)]
        cand.sort(key=lambda p: p["onset_day"])
        ev = cand[int(body.get("index", 0)) % len(cand)] if cand else None
        if not ev:
            raise HTTPException(404, "no planted event")
        was = state.mission.playing
        state.reset_to(max(-1, ev["onset_day"] - 4))
        state.mission.playing = was
        state.store.log("operator", "jump_to_event", {"crew": ev["crew_id"], "onset": ev["onset_day"]})
        await state.broadcast_snapshots()
        return {"ok": True, "event": ev, "day": state.mission.day}

    @app.post("/api/delay")
    async def delay(body: dict = Body(...)):
        key = body.get("preset")
        if key not in config.DELAY_PRESETS:
            raise HTTPException(422, f"preset must be one of {list(config.DELAY_PRESETS)}")
        state.delay_key, state.delay_min = key, config.DELAY_PRESETS[key]
        state.store.log("operator", "delay_set", {"preset": key, "min": state.delay_min})
        await state.broadcast_snapshots()
        return {"ok": True, "key": key, "min": state.delay_min}

    # -------------------------------------------------------------- consent
    @app.post("/api/consent")
    async def consent(body: dict = Body(...)):
        cid, role, granted = body.get("crew_id"), body.get("role"), bool(body.get("granted"))
        actor = body.get("actor")  # must be the crew member themselves
        need_crew(cid)
        if role != "medical":
            raise HTTPException(422, "consent can be granted to the medical designee only")
        if actor != cid:
            raise HTTPException(403, "only the crew member can change their own consent")
        state.store.set_consent(cid, role, granted)
        state.store.log(cid, "consent_set", {"role": role, "granted": granted})
        await state.broadcast_snapshots()
        return {"ok": True, "consents": state.store.consents()}

    # ------------------------------------------------------------ audit/outbox
    @app.get("/api/audit")
    def audit(n: int = Query(40, ge=1, le=500)):
        return {"entries": state.store.audit_tail(n), "chain": state.store.verify_chain()}

    @app.get("/api/audit/verify")
    def audit_verify():
        return state.store.verify_chain()

    @app.get("/api/outbox")
    def outbox(role: str = "crew"):
        need_role(role)
        return {"simulated": True, "delay_min": state.delay_min, "items": state.outbox_for(role)}

    # ------------------------------------------------------------- assistant
    @app.post("/api/assistant")
    def assistant(body: dict = Body(...)):
        question = str(body.get("question", ""))[:400]
        lang = "bn" if body.get("lang") == "bn" else "en"
        role = need_role(body.get("role", "crew"))
        viewer = body.get("viewer")
        subject = body.get("crew_id") or viewer
        if subject not in state.mission.crew:
            subject = state.crew_ids()[0]
        m = state.mission
        tier = state.tier(role, viewer, subject)
        cs = m.crew[subject]
        rec = cs.records[-1] if cs.records else None
        sigs = {s: {"v": rec["v"][s], "mu": rec["mu"][s], "sd": rec["sd"][s], "w": rec["w"][s]}
                for s in SIGNALS} if rec and tier == 0 else {}
        ctx = {"cfg": state.cfg, "alerts": cs.alerts if tier == 0 else [], "callsign": cs.meta["callsign"],
               "status": m.status_now().get(subject, "learning"), "day": m.day, "signals": sigs,
               "tier": tier, "evidence_for": lambda s: state.evidence.for_signal(s)}
        ans = ask(question, ctx, lang)
        state.store.log(role, "assistant_asked", {"intent": ans["intent"], "boundary": ans["boundary"]})
        return ans

    # ---------------------------------------------------------------- websocket
    @app.websocket("/ws")
    async def ws(websocket: WebSocket, role: str = "crew", crew: Optional[str] = None):
        if role not in privacy.ROLES:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        state.clients[websocket] = {"role": role, "viewer": crew}
        await websocket.send_text(json.dumps(state.snapshot(role, crew)))
        try:
            while True:
                txt = await websocket.receive_text()
                if txt == "ping":
                    await websocket.send_text('{"type":"pong"}')
                elif txt == "snapshot":
                    await websocket.send_text(json.dumps(state.snapshot(role, crew)))
        except WebSocketDisconnect:
            pass
        finally:
            state.clients.pop(websocket, None)

    @app.websocket("/ws/rehearsal")
    async def ws_rehearsal(websocket: WebSocket, speed: float = 1.0, start: int = 0,
                           fixture: str = "planted", paused: bool = False):
        """Replay the 1 Hz fixture at `speed` samples per second (0.1-1000).
        Client commands (JSON text): {"action": "speed"|"play"|"pause"|"seek"|"reset", "value": n}."""
        try:
            run = rehearsal_run(fixture)
        except HTTPException:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        ctl = {"speed": min(1000.0, max(0.1, float(speed))), "playing": not paused, "ended": False}
        if start > 0:
            run.reset(min(start, run.n) - 1)
        await websocket.send_text(json.dumps(run.hello(ctl["speed"])))
        if run.index >= 0:                       # started part-way: backfill the chart
            await websocket.send_text(json.dumps({"type": "reset", "next_index": run.index + 1,
                                                  "alerts": run.alerts, "samples": run.history}))

        async def reader():
            while True:
                txt = await websocket.receive_text()
                try:
                    cmd = json.loads(txt)
                except ValueError:
                    continue
                act, val = cmd.get("action"), cmd.get("value")
                if act == "speed" and isinstance(val, (int, float)):
                    ctl["speed"] = min(1000.0, max(0.1, float(val)))
                    await websocket.send_text(json.dumps({"type": "speed", "speed": ctl["speed"]}))
                elif act in ("play", "pause"):
                    ctl["playing"] = act == "play"
                elif act in ("seek", "reset"):
                    run.reset((int(val) - 1) if act == "seek" and isinstance(val, (int, float)) else -1)
                    ctl["ended"] = False
                    await websocket.send_text(json.dumps({"type": "reset", "next_index": run.index + 1,
                                                          "alerts": run.alerts, "samples": run.history}))

        rtask = asyncio.create_task(reader())
        try:
            while not rtask.done():
                if ctl["playing"] and not run.done():
                    await websocket.send_text(json.dumps(run.step()))
                    await asyncio.sleep(1.0 / ctl["speed"])
                else:
                    if run.done() and not ctl["ended"]:
                        ctl["ended"] = True
                        await websocket.send_text(json.dumps({"type": "end", "n": run.n,
                                                              "alert_count": len(run.alerts)}))
                    await asyncio.sleep(0.02)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            rtask.cancel()

    # ----------------------------------------------------------- static files
    sdir = static_dir or config.STATIC
    if sdir.exists() and (sdir / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=sdir / "assets"), name="assets") \
            if (sdir / "assets").exists() else None

        @app.get("/{path:path}")
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "not found"}, status_code=404)
            f = (sdir / path).resolve()
            if path and f.is_file() and sdir.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(sdir / "index.html")
    else:
        @app.get("/")
        def no_ui():
            return JSONResponse({"name": "Astra Vigil 2.0", "simulated": True,
                                 "message": "Frontend not built yet. See README (npm run build)."})
    return app
