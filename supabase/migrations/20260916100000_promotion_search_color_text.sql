-- Phase 7: 통합검색(브랜드/제품명/컬러)을 위한 검색 보조 컬럼.
-- color는 text[]라 PostgREST에서 부분일치(ilike) 검색이 불가능하다.
-- array_to_string로 만든 컬럼에 trigram 인덱스를 걸어 브랜드/제품명과 동일한
-- 방식(ilike)으로 검색할 수 있게 한다. Sync 엔진은 이 컬럼을 전혀 모른다
-- (트리거가 자동 계산하므로 insert/update 대상에 없음), RLS/GRANT도 테이블
-- 단위라 별도 권한 부여가 필요 없다.
--
-- `generated always as (...) stored`로 만들려 했으나 실제로 실행해보니
-- "generation expression is not immutable"(42P17)로 실패했다 —
-- array_to_string(text[], text)이 이 Postgres 버전에서 STABLE로 분류되어
-- 생성 컬럼(IMMUTABLE 요구)에 쓸 수 없었다(추측이 아니라 직접 실행해 확인).
-- 그래서 일반 컬럼 + BEFORE INSERT/UPDATE 트리거로 대체한다.

alter table public.promotions
  add column color_text text;

create or replace function public.set_promotions_color_text()
returns trigger as $$
begin
  new.color_text := array_to_string(new.color, ' ');
  return new;
end;
$$ language plpgsql;

create trigger promotions_set_color_text
  before insert or update of color on public.promotions
  for each row
  execute function public.set_promotions_color_text();

update public.promotions set color_text = array_to_string(color, ' ');

create index promotions_color_text_trgm_idx
  on public.promotions using gin (color_text gin_trgm_ops);

-- brand는 기존에 btree 인덱스만 있었다(등호/정렬용). 통합검색은 ilike 부분일치를
-- 쓰므로 product_name과 동일하게 trigram 인덱스를 추가한다.
create index promotions_brand_trgm_idx
  on public.promotions using gin (brand gin_trgm_ops);
