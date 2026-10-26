# RigidChips Script / Lua API 仕様メモ (clean-room)

## Sources (fetched 2026-10-27; ドキュメントのみ。C++ソースは未参照)
- https://wikiwiki.jp/rigidchips/RC関数リファレンス
- https://wikiwiki.jp/rigidchips/モデル書式簡易リファレンス
- https://wikiwiki.jp/rigidchips/Lua関数リファレンス (Lua 5.0.2。tonumber/table.insert/pcall/require 程度の紹介のみ)
- https://www.eonet.ne.jp/~owhari/rc/reference/rc_rf_script.htm / rc_rf_lua.htm / rc_rf_val.htm / rc_rf_script_c100.htm (v1.5.B24)
- https://ksnk.jp/rclab/explan/oprtn.html
- 403で取得不可: w.atwiki.jp/rigidchips/pages/{47,56}.html
凡例: ⚠未確認。WebFetchの要約経由、owhariはShift-JIS文字化けあり。

## 1. 宣言とバージョン
- `Lua{ ... }` (v1.5.B4以降。使用Luaは 5.0.2 系 ⚠: `math.mod`, `math.pow` があるため5.0系と整合) と、旧 `Script{ ... }`。両方あるとLuaが優先でScriptは無視。
- ロード/呼び出し:
  - `main()` : 1フレームに1回呼ばれる(Lua内に必ず1つ必要、旧記述)。
  - `OnInit()` : ロード時(Uキー/シナリオ読込)に呼ばれる。デバッグロード(Ctrl+U)では呼ばれない。
  - `OnReset()` : リセット(Rキー)で呼ばれる。デバッグ時は呼ばれない。
  - `OnFrame()` : 毎フレーム冒頭に呼ばれる。`OnFrame` と `main` が両方あると `main` は呼ばれない。
- 毎フレームの流れ: Key入力→Val変数更新→Script/Lua実行→Valのmin/max clamp(1サイクル1回)→物理(⚠順序は文書に明記なし)。
- Script/Luaは1フレーム内で終了しなければならない(無限ループでRigidChips自体がハング)。
- Val変数はLuaでは大文字名のグローバルとして読み書き。非Valグローバルはフレーム間保持。Val宣言変数のmin/maxはサイクル終了時にclamp。
- チップ名/チップ番号は数値で渡す: `_X(0)`, `_X(C_NAME)` は可、`_X("C_NAME")` は不可。名前はValと同様に大文字で参照。
- Lua内で使えないScript専用: `_VEL`, `_PLAYERNAME2`, `_ABS` 等のScript算術関数(`math.*` を使う)。ただし `_RND/_TODEG/_TORAD` は Lua でも可との記載(`math.random/deg/rad` 相当)。`_INT _FIX _ROUND _SGN _LEN2 _LEN3` は手動定義が必要。
- 出力: `out(行, 値, ...)` 行は0〜24(画面上から)。文字列は""、数値は小数2桁。行末 `&` は固定幅フォント。全角/半角カナ不可。PRINT相当(Script): `print 行, 項目, ...`。

## 2. 単位・座標系
- 角度: ラジアン(`_ANGLE` 等チップ設定値のみ度)。`_TORAD/_TODEG`。
- 長さ: m (⚠ チップ1辺のメートル値は文書なし)。速度 m/s (`_VEL(0)*3.6`=km/h)。質量 kg。
- ワールド座標: X 東+ (西-)、Y 上+、Z 南+ (北-)。→ Zが南正なので、右手系/左手系かは ⚠未確認(DirectX由来で左手系の可能性大だが文書に明記なし)。
- ローカル軸: `_VX` 右+、`_VY` 上+、`_VZ` 前(北)+。`_DIR` が 0=S 1=W 2=N 3=E、軸ベクトル `_XX.._ZZ` はN向き基準。
- 重力加速度: ⚠ 文書に数値なし(規制トグルで ON/OFF のみ)。9.8と仮定するなら独立に検証要。
- 時間: `_BASE()`=15または30 (FPS未設定時30)。`_DT()`=1/_FPS()/10 (rc_rf_script: 「フレーム時間(秒)」だがwikiwikiは 1/(_BASE×10) と表記 ⚠ 食い違い)。`_TICKS()`: 1 tick = 1/30 s。

## 3. 関数/変数一覧 (✓=2ソース以上で一致 / ◯=1ソース)
### 入出力・時間
| 名前 | 内容 | |
|---|---|---|
| `_KEY(n)` | キーnが押されていれば1 | ✓ |
| `_KEYDOWN(n)` / `_KEYUP(n)` | 押した/離したフレームだけ1 | ✓ |
| `_ANALOG(n)` | n=0〜5, -1000〜1000 | ✓ |
| `_HAT(0)` | ハットスイッチ(生値の1000倍) | ◯ |
| `_MX() _MY()` | マウス座標 px | ✓ |
| `_ML() _MR() _MM()` | マウスボタン | ✓ |
| `_WIDTH() _HEIGHT()` | 画面サイズ px | ✓ |
| `_FPS()` | 1秒あたり更新回数 | ✓ |
| `_BASE()` | 基準FPS 15/30 | ✓ |
| `_DT()` | ⚠ 上記不一致 | |
| `_TICKS()` | モデル読込から経過フレーム。150までArm不可/被弾なし | ✓ |
| `_SETTICKS(v)` | tickを設定(0でリセット) | ✓ |
| `_FACE()` | Landのポリゴン数 | ✓ |
| `_ZOOM(fov)` | 視野角度 1〜100 (0で現在値取得、既定17.19) | ✓/◯ |
| `out(row, ...)` | 画面出力 | ✓ |

### モデル/チップ状態 (n=チップ番号 or name)
| 名前 | 内容 |
|---|---|
| `_CHIPS()` | 総チップ数 (WHEEL/RLWは2) |
| `_WEIGHT()` | コア系の総質量 kg |
| `_FUEL(n)` `_FUELMAX(n)` | nをルートとする部分木の燃料/最大燃料 (WEIGHTから消費) |
| `_M(n)` | チップ質量 |
| `_E(n)` | Armのチャージ量。毎フレーム2500加算(wikiwiki)、optionまで |
| `_T(n)` | 耐久 0〜10000、破壊済み=-1 |
| `_X _Y _Z (n)` | ワールド座標 m |
| `_H(n)` | 真下の地表までの距離。検知範囲0〜約10m、無ければ -100000。海は地面扱いでない |
| `_AX _AY _AZ(n)` | 非推奨(v1.5B6〜)。AX:-π/2〜π/2, AY:-π〜π, AZ:-π/2〜π/2 (EZと符号逆) |
| `_EX _EY _EZ(n)` | オイラー角[rad]。EX=-AX, EY=AY, EZ=-AZ |
| `_RX _RY _RZ(a,b)` | チップbから見たaの相対オイラー角 |
| `_XX.._ZZ(n)` | ローカル軸のワールドベクトル (XX XY XZ / YX.. / ZX..) |
| `_QX _QY _QZ _QW(n)` | クォータニオン |
| `_VX _VY _VZ(n)` | 速度 m/s。ローカル軸(右/上/前+) |
| `_VEL(n)` | 速さ。Script専用(Luaは自作) |
| `_FX _FY _FZ(n)` | 運動量(質量×速度) |
| `_WX _WY _WZ(n)` | 角速度 rad/s。Wheel回転以外はノイズ多く、制御には非推奨 |
| `_LX _LY _LZ(n)` | 角運動量 |
| `_I(n,row,col)` | 慣性テンソル要素 (0-2) |
| `_GX _GY _GZ(n)` | nをルートとする部分木の重心 |
| `_TYPE(n)` | 0 Core,1 Chip,2 Rudder,3 Rim,4 Wheel,5 RLW,6 Trim,7 Jet,8 Weight,9 Cowl,10 Arm,33 Frame,34 RudderF,35 TrimF |
| `_DIR(n)` | 0 S,1 W,2 N,3 E (Core=0) |
| `_PARENT(n)` | 親チップ番号、なければ-1 |
| `_TOP(n)` | 属する系の根元チップ番号 |
| `_ANGLE _POWER _SPRING _DAMPER _BRAKE _COLOR _OPTION _EFFECT _USER1 _USER2 (n)` | 設定値の取得 (_ANGLEは度、Coreは-1。無いチップの_POWERは0) |
| `_BYE(n)` | nを親から切り離す。切り離した系のPOWERは0になる |
| `_SPLIT(n)` | 同上だがPOWER維持 |
- `_BYE/_SPLIT` は戻り値を変数に代入する形で呼ぶ(`t=_BYE(n)`)。Cowl単体を外すとその場に浮く。
- `_AY` 近辺の符号・左右手系は ⚠ 要検証。
- 状態取得関数は、チップがnに「系の部分木」を指す場合(_GX,_FUEL)と、単体チップを指す場合を区別。

### 物体(ボール)
`_MOBJ(n)`質量, `_IOBJ(n,r,c)`慣性, `_OX _OY _OZ(n)`座標 (物体がなければ OX=0, OY=-1000000, OZ=0)。

### CCD
`_CCD(x,y)` 15bit RGB(0〜32767)、64x64、(0,0)左上〜(63,63)右下 (wikiwikiはx,y逆の実装ミスと注記 ⚠)。`_RED/_GREEN/_BLUE(x,y)` 0〜1。"Show Meter" 無効時は0。

### 描画 (v1.5B)
`_SETCOLOR(rgb24)`, `_MOVE3D/_LINE3D(x,y,z)`, `_MOVE2D/_LINE2D(x,y)`(画面幅=2単位、中央(0,0)、上=1下=-1)。

### ネットワーク
`_PLAYERS() _PLAYERHOSTID() _PLAYERMYID() _PLAYERID(n) _PLAYERCHIPS(n) _PLAYERARMS(n) _PLAYERCOLOR(n) _PLAYERCRUSHES(n) _PLAYERRESETS(n) _PLAYERINITS(n) _PLAYERYFORCES(n) _PLAYERX/Y/Z(n)(±5m雑音) _PLAYERNAME(n) _PLAYERNAME2(n,i)`。

### 数学 (Script専用、Luaは math.* )
`_ABS _MOD _SQRT _SIN _COS _TAN _ASIN _ACOS _ATAN _ATAN2(a,b) _SGN _POW _EXP _INT _FIX _ROUND _FLOOR _CEIL _LOG _LOG10 _LEN2 _LEN3 _PI _TODEG _TORAD _RND`。
- `_MOD` は第1引数の符号を保つ(真の剰余ではない)。`_ROUND(-3.5)=-4`。`_INT=_FIX`(0方向切捨て)。`_RND()` は [0,1)。
- Luaの `math.random(a)` は 0〜a の整数(既定a=1)、`math.mod` も符号保持。

## 4. 旧 Script (RC script) 構文
- 1行1文、フレームごとに1回実行。`for/while/else/else if` なし。変数は数値のみ(文字列は保持不可、printのみ)。
- 文: `var = expr` / `if cond { ... }` / `goto label` / `label name` / `print line, item, ...`。ifのネストは不可(外側ifのブロックを抜けると全部抜ける)。`&`でAND、`|`でOR、比較は `= == != <> > < >= <=` (真=1 偽=0)。`and`/`or` も可。
- 関数呼び出しは結果を変数に代入する形(`dummy=_BYE(1)`)。
- 未宣言変数は実行中のみ有効。フレームを跨ぐ値はVal宣言。

例(トラクション制御, owhari):
```
ratio=_WY(TIRE)/_VZ(0)
if ratio>3.4 { TRQ=TRQ*0.95 }
if ratio<0 { TRQ=0 }
if(ratio<=3.4)&(ratio>=0){ TRQ=(TRQ+1000)*1.05 }
```
(TRQ は Val 変数、TIRE は name 指定のホイール。TRQ=1000前後でWheel powerを駆動することが示唆される ⚠)

## 5. Lua 最小例 (私の作成 ⚠実機未検証)
```
Val{
  STEER(default=0, min=-30, max=30, step=3)
  TORQUE(default=0, min=-500, max=500)
}
Key{ 0:STEER(step=-6), 2:STEER(step=6) }
Body{ Core(){ N:Wheel(power=TORQUE, name=W0){ } } }
Lua{
  function OnFrame()
    local v = math.sqrt(_VX(0)^2 + _VY(0)^2 + _VZ(0)^2)  -- m/s
    out(0, "kmh=", v*3.6)
    if _KEY(1) == 1 then TORQUE = 400 else TORQUE = 0 end
  end
}
```

## 6. 物理定数の確認状況
| 項目 | 状況 |
|---|---|
| チップ質量(Core/Chip基準) | 25.2 (kg ⚠単位推定) |
| 密度 | Core/Chip 0.7、Weight 2.8 |
| Frame質量 | 12.6、Weight 100.8、Arm 50.4、Jet 36.76、Wheel 42.41+36.76 |
| 重力加速度 | ⚠ 未発見 |
| チップ1辺の長さ | ⚠ 未発見 (座標単位はm) |
| 既定 spring | 1.0 / damper 0.5 / brake 0 / power 0 / angle 0 |
| 最大power | ⚠ 上限未明記("大きすぎると壊れる") |
| Jet換算 | 6 [power] = 1 [N] |
| RLW出力 | torque×(角速度+100)×0.6 |
| Arm | チャージ2500(or 5000)/frame、150tick(≈5秒@30fps)まで発射/被弾不可 |
| 耐久上限 | `_T` は0〜10000 |
| FPS | 15または30基準 |
