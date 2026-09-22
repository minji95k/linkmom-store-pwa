"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  detectPushSupportStatus,
  ensurePushSubscription,
  removePushSubscription,
  requestPushSubscription,
  type PushSupportStatus,
} from "@/lib/push/subscribe-client";

// Notification.permission에는 표준 change 이벤트가 없다 — 구독할 게 없으므로 빈
// unsubscribe만 반환한다. useSyncExternalStore를 쓰는 이유는 순전히 "서버(placeholder)와
// 클라이언트 첫 렌더가 반드시 같아야 한다"는 hydration 요구를 깨지 않으면서 브라우저
// 전용 값(window/Notification)을 안전하게 읽기 위해서다 — 이 경우 useEffect+setState는
// 매 마운트마다 렌더가 한 번 더 발생하는 것으로 react-hooks/set-state-in-effect가
// 경고하는 패턴과 같아 보이지만, useSyncExternalStore는 React가 이 "SSR 값 → 클라이언트
// 실제 값"전환을 위한 정식 API로 제공하는 것이라 별도 처리 없이 안전하다.
function subscribeNoop() {
  return () => {};
}

/**
 * Phase 11 §5: 로그인 직후 즉시 Permission을 띄우지 않는다 — MY 화면에 고정 배치된
 * 카드로, 사용자가 [알림 받기]를 직접 눌러야만 OS Permission이 뜬다. 상태
 * (unsupported/ios_not_installed/not_requested/granted/denied)를 명확히 구분해서
 * 보여준다(§6 iOS는 홈 화면 설치가 선행돼야 함을 별도 안내).
 */
export function PushPermissionCard() {
  const detectedStatus = useSyncExternalStore(subscribeNoop, detectPushSupportStatus, () => "checking" as const);
  const [overrideStatus, setOverrideStatus] = useState<PushSupportStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [healResult, setHealResult] = useState<"pending" | "ok" | "error">("pending");

  const status = overrideStatus ?? detectedStatus;
  // healing/healError는 healResult에서 파생한 값이다 — effect 진입 시점에 "시작했다"는
  // setState를 따로 하지 않아도 되므로 react-hooks/set-state-in-effect(이펙트 본문에서
  // 동기적으로 setState 호출 금지)를 자연히 피한다.
  const healing = status === "granted" && healResult === "pending";
  const healError = status === "granted" && healResult === "error";

  // Self-heal(§2/§4): permission이 "granted"일 때 로컬 구독과 서버 DB 등록 상태가
  // 어긋나 있으면(2026-09-22 Pilot에서 실제로 재현된 결함) 자동으로 맞춘다. setState는
  // 오직 비동기 완료 콜백(.then) 안에서만 호출한다 — 의존성 배열이 status 값 자체라
  // 같은 status에서는 재실행되지 않으므로 rerender마다 POST가 반복되지도 않는다.
  useEffect(() => {
    if (status !== "granted") return;
    let cancelled = false;
    ensurePushSubscription().then((result) => {
      if (cancelled) return;
      // not_granted/opted_out은 정상적으로 아무 것도 안 한 것이지 실패가 아니다.
      if (!result.ok && result.reason !== "not_granted" && result.reason !== "opted_out") {
        setHealResult("error");
      } else {
        setHealResult("ok");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleRetryHeal() {
    setHealResult("pending");
    const result = await ensurePushSubscription();
    if (!result.ok && result.reason !== "not_granted" && result.reason !== "opted_out") {
      setHealResult("error");
    } else {
      setHealResult("ok");
    }
  }

  if (status === "checking") return null;

  async function handleSubscribe() {
    setPending(true);
    setErrorMessage(null);
    const result = await requestPushSubscription();
    setPending(false);
    if (result.ok) {
      setOverrideStatus("granted");
    } else if (result.reason === "denied") {
      setOverrideStatus("denied");
    } else {
      setErrorMessage("알림 등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  async function handleUnsubscribe() {
    setPending(true);
    await removePushSubscription();
    setPending(false);
    setOverrideStatus("not_requested");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>알림 받기</CardTitle>
        <CardDescription>
          {status === "granted"
            ? healing
              ? "알림 연결 상태를 확인하고 있어요..."
              : healError
                ? "알림 연결을 완료하지 못했습니다. 다시 시도해주세요."
                : "이 기기에서 중요 변경 알림을 받고 있어요."
            : "중요한 가격변경과 행사공지를 놓치지 않도록 알려드릴게요."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        {status === "not_requested" && (
          <>
            <ul className="flex flex-col gap-1 text-sm text-text-2">
              <li>✓ 판매조건 변경</li>
              <li>✓ 중요공지</li>
              <li>✓ 행사 변경</li>
            </ul>
            <Button type="button" onClick={handleSubscribe} disabled={pending}>
              {pending ? "등록 중..." : "알림 받기"}
            </Button>
          </>
        )}

        {status === "granted" && (
          <div className="flex flex-wrap gap-2">
            {healError && (
              <Button type="button" variant="outline" size="sm" onClick={handleRetryHeal} disabled={pending || healing}>
                {healing ? "다시 시도 중..." : "다시 시도"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleUnsubscribe} disabled={pending}>
              {pending ? "해제 중..." : "이 기기 알림 끄기"}
            </Button>
          </div>
        )}

        {status === "denied" && (
          <p className="text-xs text-text-3">
            브라우저에서 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 시도해주세요.
          </p>
        )}

        {status === "ios_not_installed" && (
          <p className="text-xs text-text-3">
            iPhone에서 알림을 받으려면 먼저 Safari 공유 버튼 → &ldquo;홈 화면에 추가&rdquo;로 링크맘 매장 운영앱을 홈
            화면에 추가한 뒤, 홈 화면 아이콘으로 다시 열어주세요.
          </p>
        )}

        {status === "unsupported" && (
          <p className="text-xs text-text-3">이 브라우저는 알림 기능을 지원하지 않습니다.</p>
        )}

        {errorMessage && <p className="text-xs font-semibold text-danger">{errorMessage}</p>}
      </CardContent>
    </Card>
  );
}
