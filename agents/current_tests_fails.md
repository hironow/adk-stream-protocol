# Current Test Failures

## Overview

**Python**: 44 failed, 303 passed  
**TypeScript**: 19 failed, 426 passed, 7 skipped

---

## Python Test Failures (44 total)

### test_bidi_event_sender.py (1 failure)

**test_send_events_handles_websocket_disconnect_gracefully**
- WebSocket切断時にsend_events()が例外を投げずに処理することを検証
- 現状: 未実装

### test_confirmation_interceptor.py (8 failures)

**test_execute_confirmation_approved**
- 確認ツール実行時にフロントエンドへ委譲し、承認結果を返すことを検証
- 期待: `{"confirmed": True}` が返される
- 現状: `Function call ID not found for tool: adk_request_confirmation` エラー

**test_execute_confirmation_denied**
- 確認ツール実行時に拒否結果を返すことを検証
- 期待: `{"confirmed": False}` が返される
- 現状: 上記と同じエラー

**test_execute_confirmation_with_different_tool_names**
- 異なるツール名での確認フローが動作することを検証
- 現状: 上記と同じエラー

**test_execute_confirmation_timeout_propagation**
- タイムアウト時に適切にエラーが伝播することを検証
- 現状: 上記と同じエラー

**test_execute_confirmation_handles_missing_confirmed_field**
- `confirmed`フィールドが欠けている場合の処理を検証
- 現状: 上記と同じエラー

**test_interceptor_integrates_with_real_delegate**
- 実際のデリゲートとインターセプターの統合を検証
- 現状: 上記と同じエラー

**test_multiple_sequential_confirmations**
- 複数の連続する確認が独立して動作することを検証
- 現状: 上記と同じエラー

**test_execute_confirmation_with_complex_args**
- 複雑な引数での確認フローを検証
- 現状: 上記と同じエラー

### test_frontend_delegate.py (5 failures)

**test_frontend_delegate_execute_and_resolve**
- `execute_on_frontend()`がFutureを返し、`resolve_tool_result()`で解決されることを検証
- 現状: `Function call ID not found` エラー

**test_frontend_delegate_reject_tool_call**
- `reject_tool_call()`でFutureがエラーで解決されることを検証
- 現状: 上記と同じエラー

**test_frontend_delegate_multiple_pending_calls**
- 複数の並行ツール呼び出しが独立して解決されることを検証
- 現状: 上記と同じエラー

**test_change_bgm_delegate_call_count_spy**
- デリゲートの呼び出し回数をスパイで検証
- 現状: 上記と同じエラー

**test_get_location_delegate_call_count_spy**
- デリゲートの呼び出し回数をスパイで検証
- 現状: 上記と同じエラー

**test_get_location_delegate_not_called_on_error**
- エラー時にデリゲートが呼ばれないことを検証
- 現状: 上記と同じエラー

### test_frontend_tool_service.py (15 failures)

全テストが同じ原因で失敗:
- `execute_on_frontend()` を使ったフロントエンドツール実行フロー
- ID マッピング、タイムアウト処理、ツール結果の解決/拒否
- 現状: `Function call ID not found for tool: [tool_name]` エラー
  - ID mapper への登録後、`get_function_call_id()` が ID を見つけられない

**主な失敗テスト:**
- test_execute_on_frontend_with_id_mapper_registration
- test_execute_on_frontend_with_id_mapper
- test_execute_on_frontend_with_original_context
- test_execute_on_frontend_uses_fallback_when_no_mapping
- test_execute_on_frontend_timeout_detection
- test_execute_on_frontend_timeout_with_pending_calls_logged
- test_execute_on_frontend_resolved_before_timeout
- test_resolve_tool_result_direct_id
- test_resolve_tool_result_confirmation_prefix
- test_reject_tool_call_raises_exception
- test_set_function_call_id
- test_custom_id_mapper_injection
- test_multiple_pending_calls_independent_resolution
- test_multiple_pending_calls_one_timeout

### test_global_delegate_pattern.py (15 failures)

全テストが同じ原因で失敗:
- グローバルな `frontend_delegate` を使ったツール実行パターン
- 複数セッション、並行実行、タイムアウト、ストレステスト
- 現状: `Function call ID not found for tool: [tool_name]` エラー

**主な失敗テスト:**
- test_global_delegate_shared_across_sessions
- test_concurrent_tool_execution_with_different_tools
- test_concurrent_same_tool_multiple_times
- test_tool_timeout_when_future_never_resolved
- test_tool_rejection_raises_runtime_error
- test_spy_execute_on_frontend_called_exactly_once
- test_spy_resolve_tool_result_called_exactly_once
- test_dead_code_backend_never_sends_tool_result_events
- test_await_blocks_until_future_resolved
- test_multiple_awaits_resolve_independently
- test_stress_10_concurrent_tool_calls_random_resolution
- test_stress_rapid_sequential_calls
- test_stress_mixed_success_and_failure
- test_stress_partial_timeout_with_some_success
- test_stress_interleaved_calls_and_resolutions

---

## TypeScript Test Failures (19 total)

### lib/tests/integration/bidi-event-flow.test.ts (1 failure)

**should receive and process PCM audio from backend**
- バックエンドからのPCMオーディオチャンクを受信し処理することを検証
- 期待: `voiceChannel.playPCM()` が呼ばれる
- 現状: 未実装

### lib/tests/integration/transport-integration.test.ts (2 failures)

**should create WebSocketChatTransport with correct URL**
- ADK BIDI modeで正しいWebSocket URLでtransportが作成されることを検証
- 現状: 未実装

**should use same transport reference in useChatOptions for BIDI mode**
- useChatOptionsが同じtransportインスタンスを使用することを検証
- 現状: 未実装

### lib/tests/unit/bidi-event-receiver.test.ts (4 failures)

**should process PCM chunks and send to AudioContext**
- PCMチャンクをAudioContextへ送信することを検証
- 期待: `voiceChannel.playPCM()` が呼ばれる
- 現状: 未実装

**should buffer PCM data for WAV conversion**
- PCMデータをWAV変換用にバッファリングすることを検証
- 現状: 未実装

**should inject recorded audio before finish event**
- finish イベント前に録音されたオーディオを注入することを検証
- 現状: 未実装

**should skip PCM processing without audio context**
- AudioContextがない場合、PCM処理をスキップすることを検証
- 現状: 未実装

### lib/tests/unit/build-use-chat-options.test.ts (2 failures)

**should create WebSocketChatTransport for adk-bidi mode**
- adk-bidi modeでWebSocketChatTransportが作成されることを検証
- 現状: 未実装

**should only use WebSocketChatTransport for adk-bidi mode**
- adk-bidi mode以外でWebSocketChatTransportが使用されないことを検証
- 現状: 未実装

### lib/tests/unit/websocket-chat-transport.test.ts (5 failures)

**should send message event with correct format**
- WebSocketで正しいフォーマットのメッセージイベントを送信することを検証
- 期待: `connectionId` が number 型
- 現状: `connectionId` が undefined

**should log finish event with audio metadata**
- オーディオメタデータを含むfinishイベントをログすることを検証
- 期待: `chunkLogger.logFinish()` が呼ばれる
- 現状: 呼ばれていない（0回）

**should send tool_result event via sendToolResult()**
- `sendToolResult()` でtool_resultイベントを送信することを検証
- 期待: `ws.send()` が呼ばれる
- 現状: `ws` が undefined

**should not send tool_result when WebSocket is not open**
- WebSocketが開いていない時にtool_resultを送信しないことを検証
- 期待: 警告ログが出力される
- 現状: 警告が出力されていない

**should clear currentController on [DONE] message**
- [DONE]メッセージ受信時に `currentController` がクリアされることを検証
- 期待: `currentController` が null
- 現状: `currentController` が残っている

### lib/tests/unit/websocket-no-truncation.test.ts (5 failures)

**should send ALL messages without truncation**
- 全てのメッセージを省略せずに送信することを検証
- 期待: 100件のメッセージ全て送信
- 現状: 未実装

**should warn for large payloads but still send them**
- 大きなペイロードで警告を出しつつ送信することを検証
- 現状: 未実装

**should preserve full conversation context for ADK BIDI**
- ADK BIDIモードで会話の完全なコンテキストを保持することを検証
- 現状: 未実装

**should handle messages with complex parts (images, tools)**
- 画像やツールを含む複雑なメッセージを処理することを検証
- 現状: 未実装

**should only warn at appropriate size thresholds**
- 適切なサイズ閾値でのみ警告を出すことを検証
- 現状: 未実装

---

## 根本原因

### Python側
- **ID Mapper の実装ギャップ**: `adk_request_confirmation` などのツール名で `get_function_call_id()` を呼び出すと、IDが見つからないエラーが発生
- **確認フローの未完成**: ツール確認フローの実装が不完全で、フロントエンドとの双方向通信が未接続

### TypeScript側
- **WebSocket接続ID管理**: `connectionId` の初期化や管理が未実装
- **オーディオ処理**: PCM音声チャンクの処理とバッファリングが未実装
- **Transport統合**: WebSocketChatTransportとuseChatOptionsの統合が未完成
- **Controller管理**: StreamのController lifycycleの管理が不完全
