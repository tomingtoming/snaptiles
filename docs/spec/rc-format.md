# RigidChips .rc モデルファイル書式 (clean-room 仕様メモ)

## Sources (fetched 2026-10-27; ドキュメント/解説のみ。C++ソースは未参照)
- https://wikiwiki.jp/rigidchips/ (FrontPage 構成確認)
- https://wikiwiki.jp/rigidchips/モデル書式簡易リファレンス (v1.5B系, 2018-06-13更新)
- https://wikiwiki.jp/rigidchips/RC関数リファレンス
- https://www.eonet.ne.jp/~owhari/rc/reference/rc_rf_index.htm (Rigid Chips リファレンスマニュアル v1.5.B24)
  - rc_rf_basic.htm / rc_rf_val.htm / rc_rf_key.htm / rc_rf_body.htm / rc_rf_script.htm / rc_rf_lua.htm / rc_rf_script_c100.htm
- https://ksnk.jp/rclab/explan/oprtn.html (RigidChipsの操作説明)
- 403で取得不可: w.atwiki.jp/rigidchips/pages/{16,33,47,56}.html (検索スニペットのみ)

注意: WebFetchは要約経由。owhariの旧マニュアルはShift-JIS文字化けを含み、表のセル単位の値は特に要再確認。
凡例: ⚠未確認 = ソース間で不一致/文字化け/裏取り不足/私の推測。

## 1. ファイル全体構造
- 5ブロック: `Val{}` `Key{}` `Body{}` `Script{}` `Lua{}`。この順に記述。ブロック名は大文字小文字不問。
- 形式: `BLOCKNAME { ... }`
- Val/Key: 内容が空でも可(旧マニュアルは「省略可/内容Null」、wikiwikiは「必須」→ 空ブロックで書くのが安全)。Body: 必須。Script/Lua: 任意。
- `Lua{}` があると `Script{}` は無視される。
- ⚠ 拡張子: `.rcd` (展示場の添付名 bike08ns.rcd, 4wd.rcd) と `.txt` (Basic.txt)。`.rc` の言及は未確認。
- ⚠ 文字コード: 未確認(旧ドキュメントがShift-JISなので日本語コメントはSJISの可能性)。
- コメント: `//` 行末まで(Val/Key/Body/Script)。`/* */` 非対応。Lua内は `--` と `--[[ ... ]]`。`//` はLua内ではコメントにならない。
- 既知バグ: Script{}/Lua{} ブロックの後ろにコメントを置くとハングすることがある(wikiwiki)。
- 数値: 整数・小数。`#RRGGBB` 16進リテラル(color)。Scriptでは `#HHHHHH` を16進として読む。⚠ Val/Body内での指数表記は未確認(Luaでは可)。
- チップ総数上限 512 (WHEEL/RLWは1個で2チップ消費)。Val変数は最大256個。
- 名前(変数名・チップ名・ラベル)は英数字と `_`。大文字小文字区別なし(ただしLuaからVal変数/チップ名を参照するときは大文字)。

## 2. Val{}
```
NAME(default=0, min=0, max=<約3.4e38>, step=0, disp=1)
```
- 各オプション省略可。省略時: default=0, min=0 (⚠ minの既定が0: 負値を使うなら min=-xxx を明示), max=実質無制限, step=0, disp=表示。
- `step`: KeyもScriptも値を操作していないフレームに、毎フレーム default へ向けて戻る量(小数可、負でも絶対値扱い)。ステアリングの自動センタリングに使う。
- `disp=0` で画面表示しない。非0で表示。
- min/max のclampは1サイクルに1回(Script/Lua実行中は範囲外値がありうる)。
- Body内の属性・Keyで使う変数は必ずValで宣言。Scriptでは未宣言変数がローカルとして使えるが各サイクル終了で消える。持ち越す値はValに宣言。Luaは未宣言グローバルならフレーム間保持。
- `Var{}` も `Val{}` の別名として通る(wikiwiki)。
- ⚠ 1行に複数変数を並べられるか未確認。1行1変数が基本形。

## 3. Key{}
```
keynumber:VARNAME(step=N)[, VARNAME2(step=M) ...]
```
- キーを押している間、毎フレーム変数が step だけ加算される (例: `4:DUMMY(STEP=-2)` はZ押下中 DUMMY を毎フレーム-2)。step省略時は1 (⚠旧マニュアル説明は途中が文字化け)。
- 1キーで複数変数: カンマ区切り。
- キー番号 (既定。Setting→Configure Input(F3)で再割当可。全17キー 0..16):

| # | キー | # | キー |
|---|---|---|---|
| 0 | ← ⚠(原文が化け。ksnk.jpは左上右下の順に読める) | 9 | D |
| 1 | ↑ ⚠ | 10 | V |
| 2 | → ⚠ | 11 | B |
| 3 | ↓ ⚠ | 12 | F |
| 4 | Z | 13 | G |
| 5 | X | 14 | Q |
| 6 | C | 15 | W |
| 7 | A | 16 | E |
| 8 | S | | |

- 予約キー(モデルでは使えない): R(起こす) U(初期位置+起こす) Y(持ち上げ) I/O(ズーム) F2-F12(設定・視点) 等。Basic.txtはキー7(A)=ブレーキ、8(S)=ハンドブレーキ。
- 値は Val の min/max でclampされる。離すと Val 側 step で default に戻る。

## 4. Body{}
### 4.1 構文
```
Core(color=#RRGGBB, name=XXX) {
  N:Chip(angle=0) { ... }
  W:Rudder(angle=STEER) { }
}
```
- 一般形: `Direction:ChipType(attr=val, ...) { 子... }` (wikiwiki)。Coreは方向なし。
- Direction = 親チップのどの面に付けるか: `N` 前, `S` 後, `W` 左, `E` 右 (Core基準)。
- `{}` は子が無くても必須(wikiwiki)。
- 最上位は必ず Core。Core は複数可。Core自身は方向を持たず子になれない。
- 同じ面に複数付けられるが、複数付けるとバグることがある。
- チップ番号 = 宣言順(0始まり)。WHEEL/RLWはリムが「ローター番号-1」で、name はローターを指す。
- 属性値にVal変数名が使える。`color` は `値 / 変数 / -変数` と記載(⚠ `-変数` の意味未確認)。`option` は変数不可、`user2` も変数不可、`user1` は変数可。⚠ それ以外の属性(angle/power等)が全て変数可かは明言なし(例では angle=変数 が一般的)。
- `name=` と同名のVal変数がある場合はチップ名優先で、初回フレームに変数へチップ番号が入る。
- ⚠ 空白・改行・大文字小文字の字句規則の詳細は未確認。

### 4.2 チップ種別
軸: X=接続方向、Y=ローカル上下、Z=横(⚠ マニュアルの表現。実際の向きは要検証)。Rudder=Y軸回り(yaw)、Trim=Z軸回り(pitch/roll)。通常Chip系のangleはX軸まわりの曲げ(Xジョイント)。

| 種別 | 内容 | 質量 | 耐久/燃料 |
|---|---|---|---|
| Core | ルート。必須。密度0.7。方向・angle無し | 25.2 | 2,000,000 |
| Chip | 標準。空気抵抗中、摩擦小。angleはXジョイント | 25.2 | 1,000,000 |
| Frame | 軽量Chip。空気抵抗なし、摩擦中。option=1でゴースト(透明/衝突なし) | 12.6 | 500,000 |
| Rudder | Yジョイント(angleでY軸回り回転) | 25.2 | 1,000,000 |
| RudderF | Rudderの軽量版。option=1でゴースト | 12.6 | 500,000 |
| Trim | Zジョイント(angleでZ軸回り回転) | 25.2 | 1,000,000 |
| TrimF | Trimの軽量版。option=1でゴースト | 12.6 | 500,000 |
| Weight | 重い。密度2.8(通常の4倍)、摩擦大、空気抵抗中。optionで質量・燃料を最大8倍。燃料を最初に消費(増槽) | 100.8 | 6,000,000 |
| Cowl | 装飾。質量0・当たり無し。Cowl同士にのみ接続可(⚠「どのチップの4面にもCowlを付けられる」との記述もあり矛盾気味) | 0 | - |
| Jet | ローカルY軸方向に推力。option: 0=ジェット,1=船プロペラ,2=空気プロペラ (owhari)。wikiwikiは 1=水素気球,2=空気気球(v1.5B10+) と記載 ⚠不一致 | 36.76 | 150,000 |
| Wheel | ローカルY軸まわりに角加速度。リム+ローターで2チップ。モーター/タイヤ | リム42.41+ロータ36.76 | 170,000+150,000 |
| RLW | 反作用なし(摩擦なし)Wheel。出力=torque×(角速度+100)×0.6 (wikiwiki) | 同上 | 同上 |
| Arm | エネルギー弾発射。optionで弾強度、power>=optionで発射。チャージ 2500/frame(wikiwiki `_E`)、owhari本体表では5000/frame表記 ⚠不一致 | 50.4 | 200,000 |

- 質量は owhari 表(Core基準25.2)から転記。単位は `_WEIGHT`/`_M` が kg 表記なので kg と推定 ⚠。
- 慣性モーメント(Ix/Iy/Iz): Core/Chip/Rudder/Trim 0.777/1.512/0.777; Frame系 0.381/0.756/0.381; Weight 3.108/6.048/3.108; Jet 0.858/1.654/0.858; Wheelリム 1.511/0.477/1.511 + ローター 0.858/1.654/0.858; Arm 1.554/3.024/1.554。⚠ 軸の対応は未検証。
- owhari表の化けた係数列(空気抵抗等?): Chip 1.00, Frame 0.00, Weight 1.00, Jet 0, Wheel 0.05, Arm 0.70 ⚠意味未確認。
- 燃料値: 旧版/B24値。Core 2,000,000 / Chip 1,000,000 / Frame 500,000 / Weight 6,000,000。
- `_TYPE()` コード: Core0 Chip1 Rudder2 Rim3 Wheel4 RLW5 Trim6 Jet7 Weight8 Cowl9 Arm10 Frame33 RudderF34 TrimF35。
- ⚠ チップ1辺の幾何寸法は、読んだどのドキュメントにも数値なし。座標単位は m(速度km/h=`_VEL(0)*3.6`、`_H`の検知距離10m、高度計大針1目盛=10m)。

### 4.3 属性表
| 属性 | 意味 | 既定 |
|---|---|---|
| color | `#RRGGBB`(0〜16777215) か 変数 | #FFFFFF |
| name | 英数字と`_`。Script/Luaからチップ番号として使う | なし |
| angle | 度。非ジョイント: 接続部の曲げ(Xジョイント)。Rudder/RudderF/Trim/TrimF: 自身の回転。ジョイント種別はXジョイントで曲げられない。Core不可(`_ANGLE(core)`は-1) | 0 |
| spring | 接続部の復元力。0〜1 | 1.0 |
| damper | 接続部の動きへの減衰。0〜1 (1=剛, 0=柔)、推奨0〜0.5。spring=1かつdamper=1でガタつく | 0.5 |
| power | Jet/Wheel/RLW/Arm。符号で向き反転。大きすぎるとモデル破損。Jet: 6[power]=1[N] (wikiwiki) | 0 |
| brake | Wheel/RLWのみ。回転抵抗。通常>=0、負は不安定 | 0 |
| option | Frame系: 1=ghost。Weight: 質量倍率1〜8。Cowl: 形状(0平板,3/4直角三角形,5曲面,1/2は化け ⚠)。Jet: 上記。Wheel/RLW: ローター半径 0/1/2 ⚠。Arm: 弾エネルギー閾値。変数不可 | 0 |
| effect | Cowl: `#PQRS`各0-F (P透明度 Q反射 R鏡面サイズ S鏡面鋭さ, 既定#00FB)。Jet: 排気エフェクト0-4。Wheel/RLW: リム太さ1〜10(衝突判定不変) | 0 (Cowl:#00FB) |
| user1 | シナリオ用(変数可) | 0 |
| user2 | シナリオ用(変数不可) | 0 |

- 対応属性: Core: color,name,user1,user2のみ。Chip/Rudder/Trim: +angle,damper,spring。Frame系/Weight: +option。Cowl: color,name,angle,option,effect,user。Jet: +power,option,effect。Wheel/RLW: +power,brake,option,effect。Arm: +power,option(brake/effectなし)。
- ⚠ angleの許容範囲、Wheel powerの実用値域は未確認(トラクション制御例では TRQ を1000前後で加減)。

## 5. 実行環境メモ
- 規制トグル: 重力/空気抵抗/ホイールトルク/ジェット/壊れない/CCD/スクリプト。
- `_TICKS()` が150になるまで Arm は発射不可・被弾なし。`_BASE`=15か30 (FPS上限30)。

## 6. 例モデル (私の作成。文法に従う。実機動作は ⚠未検証)

### 6.1 最小
```
Val{}
Key{}
Body{
  Core(color=#FF0000){
    N:Chip(){ }
  }
}
```

### 6.2 4輪ステアリング車
```
Val{
  STEER(default=0, min=-30, max=30, step=3)
  TORQUE(default=0, min=-500, max=500, step=10)
}
Key{
  0:STEER(step=-6)      // 左 (⚠0番が左か未確認)
  2:STEER(step=6)       // 右
  1:TORQUE(step=30)     // 前進
  3:TORQUE(step=-30)    // 後退
}
Body{
  Core(color=#2060FF){
    W:Rudder(angle=STEER, name=FL_R){
      N:Wheel(power=TORQUE, brake=0.1, name=FL){ }
    }
    E:Rudder(angle=STEER, name=FR_R){
      N:Wheel(power=TORQUE, brake=0.1, name=FR){ }
    }
    S:Chip(){
      W:Wheel(power=TORQUE, brake=0.1, name=RL){ }
      E:Wheel(power=TORQUE, brake=0.1, name=RR){ }
    }
  }
}
```
⚠ Wheelの取り付け面と回転軸(ローカルY)の関係、左右で power 符号反転が要るかは未確認。

### 6.3 簡易飛行機
```
Val{
  THR(default=0, min=0, max=1000, step=0)
  ELEV(default=0, min=-20, max=20, step=2)
  AIL(default=0, min=-20, max=20, step=2)
}
Key{
  7:THR(step=10)
  8:THR(step=-10)
  1:ELEV(step=-4)
  3:ELEV(step=4)
  0:AIL(step=-4)
  2:AIL(step=4)
}
Body{
  Core(color=#FFFFFF){
    N:Jet(power=THR, effect=1){ }
    S:Frame(){
      S:TrimF(angle=ELEV, name=ELEVATOR){
        W:Frame(){ }
        E:Frame(){ }
      }
    }
    W:Frame(){ W:TrimF(angle=AIL){ W:Frame(){ } } }
    E:Frame(){ E:TrimF(angle=AIL){ E:Frame(){ } } }
  }
}
```
⚠ Jetの推力はチップのY軸方向なので、機首方向へ向けるにはチップ姿勢(angleや接続)に注意。翼の揚力モデル(面積による空気抵抗か)の仕様は文書で見つからず未確認。
