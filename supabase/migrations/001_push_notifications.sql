-- プッシュ通知登録テーブル
CREATE TABLE IF NOT EXISTS push_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token text NOT NULL,
  account_id text NOT NULL,
  account_email text NOT NULL,
  imap_host text NOT NULL,
  imap_port int NOT NULL DEFAULT 993,
  imap_secure boolean NOT NULL DEFAULT true,
  encrypted_password text NOT NULL,
  last_uid int NOT NULL DEFAULT 0,
  provider text NOT NULL DEFAULT 'imap', -- 'imap' | 'gmail' | 'outlook'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_token, account_email)
);

-- RLS有効化（Edge FunctionはService Role Keyで全操作可）
ALTER TABLE push_registrations ENABLE ROW LEVEL SECURITY;

-- updated_atを自動更新するトリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER push_registrations_updated_at
  BEFORE UPDATE ON push_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- pg_net拡張（Edge FunctionをHTTP呼び出しするために必要）
CREATE EXTENSION IF NOT EXISTS pg_net;
