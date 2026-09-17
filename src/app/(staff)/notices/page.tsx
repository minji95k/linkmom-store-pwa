import { NoticeListItem } from "@/components/notices/notice-list-item";
import { RealtimeUpdateBanner } from "@/components/realtime/realtime-update-banner";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getNoticesForStaff } from "@/lib/notices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 목록을 만드는 건 이 컴포넌트가 아니라 RLS다: notice_visible_to_current_user가
 * 대상(Targeting)과 게시기간을 이미 걸러주므로 여기서는 정렬/표시만 한다(§4, §5).
 */
export default async function NoticesPage() {
  const currentUser = (await getCurrentUser())!;
  const supabase = await createClient();
  const notices = await getNoticesForStaff(supabase, currentUser.id);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 pb-4">
      <h1 className="text-lg font-black">공지</h1>

      <RealtimeUpdateBanner
        channelName="notices-list"
        watches={[{ table: "notices", event: "*" }]}
        label="새로운 공지가 있습니다."
      />

      {notices.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-3">현재 확인 가능한 공지가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notices.map((notice) => (
            <NoticeListItem key={notice.id} notice={notice} />
          ))}
        </div>
      )}
    </main>
  );
}
