# THE SESSION TOOLS — MV3 Audio PoC 検証結果

## 目的

Firefox 拡張の Manifest V3（MV3）で、The Session を開いたまま練習に使えるメトロノームを実現できるか検証した。

確認対象は次のとおり。

- 別タブ・別アプリ・最小化中の再生継続
- The Session 内のページ遷移をまたぐ再生継続
- 非アクティブ時のタイムアウト停止と、復帰時の無操作自動再開
- ユーザーによる Stop とタイムアウト停止の状態分離

本書の結果は開発中の手動 PoC に基づく。ブラウザの正確なバージョン、OS、長時間連続再生の結果は、本実装の受け入れ試験で追加記録する。

## PoC 1: content script 内の AudioContext

The Session ページに注入した content script が `AudioContext` とメトロノームのクリック音を直接保持する方式を検証した。

### 結果

| 観測項目 | Firefox | Chrome | 結果 |
| --- | --- | --- | --- |
| 別タブへの移動 | 確認済み | 確認済み | 可聴クリックは継続した |
| ブラウザ最小化 | 確認済み | 確認済み | 可聴クリックは継続した |
| 5分間の背景化 | 確認済み | 確認済み | タイマー制限による停止は観測されなかった |
| 5分タイムアウト後の無操作復帰 | 確認済み | 確認済み | 同じ document 上では自動復帰した |
| The Session の通常のページ遷移 | 停止 | 停止 | document と content script が破棄されるため音源も停止した |

### 判明したこと

可聴音声を出している Web ページは、背景タブであっても実用上メトロノームを継続できた。このため、MV3 でも背景・最小化中の再生そのものは可能である。

一方、content script の寿命はページ document の寿命と同じである。The Session の通常のフルページ遷移では `AudioContext` が破棄されるため、音源ホストとして単独採用はできない。

遷移先で保存済みの再生希望を読み、新しい `AudioContext` を無操作で作成する PoC も試したが、自動再生制約により遷移先で再開できなかった。戻る操作では、bfcache で復元された元 document の、ユーザー操作済み `AudioContext` が戻るため再生された。

## PoC 2: Firefox MV3 background event page の AudioContext

Firefox MV3 の `background.scripts` で作られる event page を音源ホストとし、The Session の content script は UI とメッセージ送受信だけを担う方式を検証した。

```text
The Session content script
  └─ Play / Stop / 状態表示
       ↕ runtime メッセージ
Firefox MV3 background event page
  └─ AudioContext / 先読みスケジューラ / 再生状態
```

### 結果

| 観測項目 | 結果 |
| --- | --- |
| content script の Play 操作から background の AudioContext を開始 | 確認済み |
| The Session 内のページ遷移中の音源継続 | 確認済み |
| 遷移先に再注入された UI の状態取得 | 確認済み |
| 別タブ・最小化中の継続 | 確認済み |
| 背景・最小化中の5分継続 | 確認済み |
| Chrome で同じ manifest を動かす | 不可（想定どおり） |

Firefox では、MV3 background event page がページ遷移から独立した音源ホストとして機能した。これは v0.1.0 の「The Session 内を移動しても、ユーザーが Stop するまで音が消えない」要件に適合する。

## 非アクティブ時のタイムアウト PoC

次の状態を分離する方式を検証した。

```text
userWantsPlayback      ユーザーが再生を希望しているか
audioActuallyPlaying   現在、クリック音を再生しているか
autoResume             アクティブ復帰時に自動再開するか
```

5分仕様を短縮した15秒タイムアウト PoC では、別タブ移動・最小化後に停止することを確認した。ただし、次の不具合も観測した。

- アクティブなページに戻った後も古いタイマー callback が発火して停止する
- 非アクティブ化後、タイムアウト前に戻っても停止することがある

これは MV3 の制限ではなく PoC のタイマー無効化処理の競合である。実装では次の対策を必須とする。

- 非アクティブ状態の変更ごとに `inactivityGeneration` を増やす
- 停止タイマー開始時の generation を callback に保持する
- callback 実行時に、generation 一致かつ現在も非アクティブの場合だけ停止する
- content script の `visibilitychange` だけに依存せず、`tabs.onActivated` とウィンドウ状態も併用する

タイムアウトによる停止では `userWantsPlayback` を維持する。ユーザーの Stop ではこれを解除する。この区別により、復帰時の自動再開はユーザーの明示的な停止を覆さない。

## MV3 background event page の短時間停止と heartbeat PoC

background event page を音源ホストにした PoC では、The Session が表示されたままでも、再生開始からおよそ20〜30秒後にクリック音が止まる事象を観測した。これは5分の非アクティブタイムアウトではない。

停止後に UI 操作で `getState` を送ると、新しい `background initialized` 状態が返った。したがって、`AudioContext` やスケジューラが停止したのではなく、Firefox MV3 がアイドルと判定した background event page を破棄し、音源を含むメモリ状態が失われたことが原因である。

一方、content script 内の AudioContext PoC は、The Session の背景化・別アプリへの切替・Firefox最小化中も安定して動作した。そこで content script から background へ1秒ごとの無害な `heartbeat` メッセージを送る PoC を追加した。

### heartbeat PoC 結果

| 観測項目 | 結果 |
| --- | --- |
| heartbeat なし | 約20〜30秒後に background event page が破棄され、クリック音が停止した |
| 1秒ごとの heartbeat あり | 3分超の連続再生を確認した（`ticks:404`、`AudioContext: running`） |
| ユーザーStop | schedulerのみ停止し、`AudioContext` は running のまま。次回Playで再利用できた |

### 採用する対策

- background event page を音源ホストとして維持する。
- The Session の各 content script は、存在している間だけ1秒ごとに `heartbeat` を background へ送る。
- heartbeat は状態変更・UI再描画・ストレージ書き込みを行わず、event page を活動中に保つためだけに使う。
- ページ遷移時は古い content script の heartbeat が破棄され、遷移先へ注入された新しい content script が直ちにheartbeatを開始する。
- heartbeat の間隔は、今回確認された約20〜30秒の破棄より十分短い1秒とする。Firefoxの実装変更で持続性が変わる可能性があるため、受け入れ試験ではページ遷移・背景化・最小化を含む連続再生を確認する。

## 採用判断

v0.1.0 は Firefox 専用の MV3 拡張として実装する。

- **音源ホスト**: Firefox MV3 background event page
- **UI**: The Session に注入する content script
- **状態保持**: background が `{ bpm, userWantsPlayback, audioActuallyPlaying, autoResume }` を唯一管理する
- **保存**: `bpm` と `autoResume` は `storage.local` に保存する。再生希望はブラウザ再起動後に復元しない
- **非アクティブ時**: 5分後に音のみ停止し、再生希望を維持する。復帰時に `autoResume` が有効なら自動再開する
- **終了条件**: ユーザーの Stop、または最後の The Session タブを閉じたとき
- **event page維持**: content script から1秒ごとのheartbeatを送る

## Chrome 対応について

Chrome MV3 は `background.scripts` を音源ホストにできない。MV3 の background は service worker であり、DOM と `AudioContext` を持たないためである。

将来 Chrome に対応する場合は、次のように実装を分ける。

| ブラウザ | MV3 音源ホスト |
| --- | --- |
| Firefox | background event page |
| Chrome / Chromium | offscreen document |

Chrome 対応は v0.1.0 のスコープ外とする。

## 本実装での受け入れ試験

- The Session のページ遷移後も、音が継続する
- 別タブ、別アプリ、最小化中に5分間は再生する
- 非アクティブ5分後に停止し、復帰後に無操作で再開する
- `autoResume` が無効なら、復帰後も停止したままである
- ユーザーが Stop した場合は、ページ遷移・復帰後も再開しない
- 最後の The Session タブを閉じたとき、再生希望を解除して停止する
- 長時間の可聴再生中に Firefox MV3 background event page が維持されることを確認する
