# EGOIST TEAM TP

チーム戦のTP計算・共有ツール

## デプロイ手順

1. Supabaseでプロジェクト作成し、`deals` テーブルを作成 (SQLは下記)
2. このリポジトリをVercelにインポート
3. 環境変数を設定:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. デプロイ

## Supabase SQL

```sql
create table deals (
  id text primary key,
  product text not null,
  scenario text not null,
  contributions jsonb not null,
  team_tp integer not null,
  recorder text,
  time text,
  created_at timestamptz default now()
);

alter table deals enable row level security;
create policy "anyone can read" on deals for select using (true);
create policy "anyone can insert" on deals for insert with check (true);
create policy "anyone can delete" on deals for delete using (true);
```
