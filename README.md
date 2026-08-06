# Google Drive Utility

大学の Google Workspace で、許可された教職員が限定的な Drive 整理作業を行うための内部向け Web アプリです。管理者向けの全Drive監査ツールではなく、利用者本人の OAuth 権限で画面上の同期処理を実行します。

## 機能

- 指定フォルダ直下の Drive URL（`webViewLink`）一覧取得
- 複数フォルダの一括作成
- 既存ファイルの複数名称での複製
- 既存フォルダの再帰的複製
- 名簿とフォルダ対応表を用いた、学内ユーザーへの閲覧・編集権限の一括付与
- 結果一覧のクリップボードコピーとCSV出力

権限削除、role downgrade、外部ユーザー・Google Group・domain・anyoneへの共有、refresh tokenによる自動更新、background jobには対応しません。処理はtransactionではなく、成功・失敗・スキップが混在することがあります。失敗時は保存先と結果一覧を確認してから再実行してください。

## 必要な環境変数

`.env.example` を `.env.local` にコピーして設定します。空値や不正な設定ではログインおよびDrive API利用をfail-closedで拒否します。

| 変数 | 内容 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 Web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `NEXTAUTH_URL` | アプリの公開URL。開発時は `http://localhost:3000` |
| `NEXTAUTH_SECRET` | 十分に長いランダム値 |
| `ALLOWED_DOMAIN` | 許可する Workspace hosted domain の完全一致値 |
| `ALLOWED_OPERATOR_EMAILS` | ログインを許可する教職員メールのカンマ区切り完全一致リスト |

Google Cloud では OAuth consent screen、Web application client、承認済みredirect URI（例: `https://your-host/api/auth/callback/google`）を設定します。本アプリは `https://www.googleapis.com/auth/drive` を要求します。この full Drive scope は Google の Restricted scope であり、組織内限定公開の要件、Google Workspace管理者の承認、Googleのポリシーを事前に確認してください。OAuth要求の `hd` は画面上のヒントにすぎず、ログイン時にはGoogleの検証済みprofileの `hd`、`email_verified`、operator allowlistをサーバー側で照合します。

access tokenは暗号化されたNextAuth JWT cookie内だけに保持し、client sessionには返しません。refresh tokenは要求・保存しません。認証期限が切れた場合は処理を中止し、画面の「再ログイン」からログインし直してください。

## ローカル専用運用

初回と更新後は `npm ci`、`npm run build` を実行します。通常は `npm run start:local` で起動し、ブラウザで `http://localhost:3000` を開きます。終了時はログアウトしてからターミナルで `Ctrl+C` を押してください。

`.env.local` はGitへ追加しないでください。表示されるNetwork URLや別端末からは利用せず、このPCのブラウザからだけアクセスしてください。

## Shared Drive

一覧・コピー・作成は Shared Drive 用パラメーターを付けて実行し、100件を超える一覧も全pageを取得します。ただし、操作可能範囲はログイン利用者が閲覧・追加・コピーできる対象だけです。domain-wide delegationやservice accountは使用しません。Driveが `incompleteSearch` を返した場合は、不完全な結果を成功扱いせず処理を中止します。

## 入力形式

URLは `https://drive.google.com` のフォルダ/ファイルURL、および必要な `https://docs.google.com` の Docs、Sheets、Slides、Forms、Drawings URLだけを受け付けます。

権限付与はExcelまたはGoogle Sheetsから貼り付ける2列TSVです。CSVや空白区切りには対応しません。空白を含むグループ名はそのまま保持されます。不正な行は行番号付きで表示されます。

```text
教員A@example.ac.jp<Tab>ゼミ A
教員B@example.ac.jp<Tab>ゼミ A
```

```text
ゼミ A<Tab>https://drive.google.com/drive/folders/...
```

## CSV出力

出力列は `種別,名前,URL`、文字コードはUTF-8（BOM付き）、改行はCRLFです。引用符、カンマ、セル内改行をRFC 4180形式でescapeし、`=`, `+`, `-`, `@` で始まるセルには先頭にapostropheを付けてspreadsheet formula injectionを防止します。downloadにはBlob URLを使用します。

## 開発と検証

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

testはmockしたDrive clientだけを使います。実在するGoogle Driveアカウントや実データを自動testに使用しないでください。また、本アプリでは臨床情報、要配慮個人情報、患者情報、未匿名化の研究データを扱わないでください。
