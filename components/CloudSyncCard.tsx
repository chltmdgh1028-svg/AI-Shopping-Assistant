"use client";

import { Cloud, Link2, LogIn, LogOut, WifiOff } from "lucide-react";
import type { CloudState } from "@/repository/supabaseShoppingRepository";

export function CloudSyncCard({
  state,
  onLinkKakao,
  onSignInKakao,
  onSignOut,
}: {
  state: CloudState;
  onLinkKakao: () => void;
  onSignInKakao: () => void;
  onSignOut: () => void;
}) {
  if (!state.available) {
    return (
      <aside className="cloud-sync-card" aria-live="polite">
        <WifiOff size={18} aria-hidden="true" />
        <div>
          <strong>이 기기에 저장 중입니다.</strong>
          <p>Supabase 환경변수를 연결하면 기록을 다른 기기에서도 이어볼 수 있어요.</p>
        </div>
      </aside>
    );
  }

  const identity = state.identity;
  const isLinked = Boolean(identity?.isLinked);
  return (
    <aside className="cloud-sync-card" aria-live="polite">
      {identity?.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : <Cloud size={18} aria-hidden="true" />}
      <div>
        <strong>{isLinked ? `${identity?.displayName ?? "Kakao 계정"}에 보관 중` : "다른 기기에서도 기록 보관하기"}</strong>
        <p>
          {state.loading
            ? "저장 공간을 준비하는 중입니다."
            : isLinked
              ? "프로필, 취향, 분석 기록이 Supabase에 저장되고 있어요."
              : "지금 기록은 익명 계정에 저장됩니다. Kakao를 연결하면 같은 데이터를 다른 기기에서도 불러올 수 있어요."}
        </p>
        {state.error && <p className="cloud-sync-error">{state.error}</p>}
        {isLinked ? (
          <div className="cloud-sync-actions">
            <button type="button" className="ghost-sync-button" onClick={onSignOut} disabled={state.loading}>
              <LogOut size={16} aria-hidden="true" />
              로그아웃
            </button>
          </div>
        ) : (
          <div className="cloud-sync-actions">
            <button type="button" className="kakao-button" onClick={onLinkKakao} disabled={state.loading}>
              <Link2 size={16} aria-hidden="true" />
              Kakao로 연결
            </button>
            <button type="button" className="ghost-sync-button" onClick={onSignInKakao} disabled={state.loading}>
              <LogIn size={16} aria-hidden="true" />
              연결한 기록 불러오기
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
