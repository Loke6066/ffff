import time
import uuid
import threading
from typing import Dict, Optional, Any

class Session:
    def __init__(self, duration_minutes: int, client_name: str = "Client"):
        self.token = str(uuid.uuid4())[:12]
        self.client_name = client_name
        self.duration_seconds = duration_minutes * 60
        self.created_at = time.time()
        self.started_at: Optional[float] = None
        self.expires_at: Optional[float] = None
        self.is_active = True
        self.client_connected = False
        self.client_ip: Optional[str] = None
        self.source_face = None          # Detected Face object from uploaded target image
        self.source_image_bytes = None
        self.enhancer: str = "none"      # "none", "face_enhancer_gpen256", "face_enhancer_gpen512"
        self.opacity: float = 1.0
        self.fps: float = 0.0
        self.total_frames_processed: int = 0
        self.last_frame_time = time.time()

    def start_session_timer(self):
        """Timer starts when client actually begins streaming or opens page."""
        if self.started_at is None:
            self.started_at = time.time()
            self.expires_at = self.started_at + self.duration_seconds

    def get_remaining_seconds(self) -> int:
        if not self.is_active:
            return 0
        if self.expires_at is None:
            return self.duration_seconds
        remaining = int(self.expires_at - time.time())
        if remaining <= 0:
            self.is_active = False
            return 0
        return remaining

    def is_expired(self) -> bool:
        return self.get_remaining_seconds() <= 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "token": self.token,
            "client_name": self.client_name,
            "duration_minutes": self.duration_seconds // 60,
            "remaining_seconds": self.get_remaining_seconds(),
            "is_active": self.is_active and not self.is_expired(),
            "client_connected": self.client_connected,
            "client_ip": self.client_ip,
            "has_face": self.source_face is not None,
            "fps": round(self.fps, 1),
            "enhancer": self.enhancer,
            "opacity": self.opacity,
            "total_frames": self.total_frames_processed
        }

class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.lock = threading.Lock()

    def create_session(self, duration_minutes: int, client_name: str = "Client") -> Session:
        with self.lock:
            session = Session(duration_minutes=duration_minutes, client_name=client_name)
            self.sessions[session.token] = session
            return session

    def get_session(self, token: str) -> Optional[Session]:
        with self.lock:
            session = self.sessions.get(token)
            if session and session.is_expired():
                session.is_active = False
            return session

    def terminate_session(self, token: str) -> bool:
        with self.lock:
            if token in self.sessions:
                self.sessions[token].is_active = False
                return True
            return False

    def list_sessions(self) -> list:
        with self.lock:
            # clean up very old sessions (older than 24h)
            now = time.time()
            for token in list(self.sessions.keys()):
                s = self.sessions[token]
                if now - s.created_at > 86400:
                    del self.sessions[token]
            return [s.to_dict() for s in self.sessions.values()]

session_manager = SessionManager()
