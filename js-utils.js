# 📚 js-utils.js 集成指南

## 概述

`js-utils.js` 是一個包含 **3 個核心類** 和 **30+ 個工具函數** 的工具庫。

這些工具可以在多個 HTML 文件中使用，提高代碼復用性和一致性。

---

## 📍 3 種集成方式

根據你的項目結構和需求，選擇其中一種：

### 方式 1️⃣: 單獨文件集成（推薦 - 最靈活）

**優點**: 
- ✅ 代碼清晰，易於維護
- ✅ 可以在多個 HTML 中復用
- ✅ 便於版本控制和更新
- ✅ 符合最佳實踐

**步驟**:

#### Step 1: 將 js-utils.js 保存到項目根目錄

```
你的項目目錄/
├── index.html
├── login.html
├── admin.html
├── register.html
├── js-utils.js          ← 放在這裡
└── ...其他文件
```

#### Step 2: 在每個需要的 HTML 文件中引入

在 `<body>` 結束前，所有其他 `<script>` 之前添加：

```html
<!-- 在 <script type="text/babel"> 之前添加 -->
<script src="js-utils.js"></script>

<!-- 然後是你的應用 -->
<script type="text/babel">
  // 你的代碼可以直接使用 APIClient, Validator, Utils
  const client = new APIClient('https://api.example.com');
</script>
```

**完整的 HTML 模板**:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>你的應用</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.6/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>

  <!-- ✅ 添加 js-utils.js 引入 -->
  <script src="js-utils.js"></script>

  <!-- 你的應用代碼 -->
  <script type="text/babel">
    const { useState, useEffect } = React;

    function App() {
      // 現在可以直接使用 APIClient, Validator, Utils
      useEffect(() => {
        const client = new APIClient('https://api.example.com');
        // 使用 client...
      }, []);

      return <div>你的應用</div>;
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

---

### 方式 2️⃣: 直接內聯到 HTML（簡單但不推薦）

**優點**:
- ✅ 無需額外文件引入
- ✅ 單個 HTML 文件自成一體

**缺點**:
- ❌ 代碼冗長
- ❌ 重複代碼多（如果多個 HTML 都需要）
- ❌ 難以維護

**步驟**:

1. 打開 `js-utils.js`，複製全部內容
2. 在你的 HTML 文件中，找到 `<script type="text/babel">` 標籤
3. 在 `<script type="text/babel">` 之前添加新的 `<script>` 標籤
4. 粘貼 `js-utils.js` 的內容

**示例**:

```html
<script>
  // 這裡粘貼 js-utils.js 的全部內容（不包括最後的 module.exports）
  
  class APIClient {
    // ... 完整的類定義
  }
  
  class Validator {
    // ... 完整的類定義
  }
  
  class Utils {
    // ... 完整的類定義
  }
</script>

<script type="text/babel">
  // 你的應用代碼可以直接使用 APIClient, Validator, Utils
  const client = new APIClient('https://api.example.com');
</script>
```

---

### 方式 3️⃣: 放在 js 子文件夾（專業項目結構）

**優點**:
- ✅ 項目結構清晰
- ✅ 易於擴展和管理
- ✅ 符合企業級標準

**缺點**:
- ❌ 需要建立文件夾
- ❌ 引入路徑需要調整

**步驟**:

#### 建立文件夾結構

```
你的項目目錄/
├── index.html
├── login.html
├── admin.html
├── register.html
├── js/                    ← 新建文件夾
│   ├── js-utils.js        ← 放在這裡
│   ├── api-client.js      ← 可選：拆分 APIClient
│   ├── validator.js       ← 可選：拆分 Validator
│   ├── utils.js           ← 可選：拆分 Utils
│   └── config.js          ← 可選：配置文件
└── ...其他文件
```

#### 在 HTML 中引入

從根目錄引入 js 文件夾中的文件：

```html
<script src="js/js-utils.js"></script>

<script type="text/babel">
  // 現在可以使用 APIClient, Validator, Utils
</script>
```

---

## 🔧 如何在各個文件中使用

### 在 index.html 中使用

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <!-- ... head 標籤 ... -->
</head>
<body>
  <div id="root"></div>

  <!-- ✅ 引入 js-utils -->
  <script src="js-utils.js"></script>

  <script type="text/babel">
    const { useState, useEffect } = React;
    const CONFIG = {
      WORKER_URL: 'https://travelkeeper.fangwl591021.workers.dev',
      LIFF_ID: '2009367829-BDZCGti8'
    };

    function App() {
      const [data, setData] = useState([]);
      const [error, setError] = useState(null);

      useEffect(() => {
        // ✅ 使用 APIClient 進行 API 調用
        const fetchData = async () => {
          try {
            const client = new APIClient(CONFIG.WORKER_URL, 8000);
            const result = await client.get('/api/itineraries');
            
            if (result.success) {
              setData(result.data);
            } else {
              setError(result.error);
            }
          } catch (err) {
            // ✅ 使用 Utils 的錯誤處理
            console.error('Error:', err);
            setError('數據加載失敗');
          }
        };

        fetchData();
      }, []);

      return (
        <div>
          {error && <p className="text-red-600">{error}</p>}
          {data.length > 0 && (
            <div>
              {data.map((item, idx) => (
                <div key={idx}>
                  {/* 渲染數據 */}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

### 在 admin.html 中使用驗證

```html
<script src="js-utils.js"></script>

<script type="text/babel">
  function AdminApp() {
    const [draftData, setDraftData] = useState(null);

    const handleConfirm = async () => {
      // ✅ 使用 Validator 驗證數據
      const validation = Validator.validateItinerary(draftData);
      
      if (!validation.isValid) {
        validation.errors.forEach(err => {
          console.error(err);
          showToast(err, 'error');
        });
        return;
      }

      // 數據有效，繼續提交
      const client = new APIClient(CONFIG.WORKER_URL);
      const result = await client.post('/api/itineraries', draftData);
      
      if (result.success) {
        showToast('✅ 發布成功！');
      } else {
        showToast(result.error, 'error');
      }
    };

    return (
      <button onClick={handleConfirm}>
        確認發布
      </button>
    );
  }
</script>
```

### 在 register.html 中使用驗證

```html
<script src="js-utils.js"></script>

<script type="text/babel">
  function RegisterApp() {
    const [formData, setFormData] = useState({
      name: '',
      phone: '',
      email: '',
      idNumber: ''
    });
    const [errors, setErrors] = useState([]);

    const handleSubmit = async () => {
      // ✅ 使用 Validator 驗證註冊信息
      const validation = Validator.validateRegistration(formData);
      
      if (!validation.isValid) {
        setErrors(validation.errors);
        return;
      }

      // ✅ 使用 Utils 複製到剪貼板
      const distributionCode = `TK${liffProfile.userId.slice(-8)}`;
      await Utils.localStorage.set('distributionCode', distributionCode);

      // 提交註冊
      const client = new APIClient(CONFIG.WORKER_URL);
      const result = await client.post('/api/register', {
        ...formData,
        distributionCode,
        uid: liffProfile.userId
      });

      if (result.success) {
        showToast('✅ 註冊成功！');
        // 複製推薦代碼
        await Utils.copyToClipboard(distributionCode);
      }
    };

    return (
      <div>
        {errors.map((err, idx) => (
          <p key={idx} className="text-red-600">{err}</p>
        ))}
        <button onClick={handleSubmit}>提交註冊</button>
      </div>
    );
  }
</script>
```

---

## 📚 js-utils.js 包含的類和方法

### 1️⃣ APIClient 類

```javascript
// 初始化
const client = new APIClient('https://api.example.com', 8000);

// GET 請求
const result = await client.get('/endpoint', { param: 'value' });

// POST 請求
const result = await client.post('/endpoint', { data: 'value' });

// 獲取友好的錯誤消息
const msg = client.getErrorMessage(error);
```

### 2️⃣ Validator 類

```javascript
// 驗證行程數據
const result = Validator.validateItinerary(data);
if (!result.isValid) {
  console.log(result.errors); // 錯誤列表
}

// 驗證註冊信息
const result = Validator.validateRegistration(data);

// 清理 HTML（防止 XSS）
const clean = Validator.sanitizeHTML(userInput);

// 驗證 URL
const isValid = Validator.isValidURL(url);

// 驗證 UID
const isValid = Validator.isValidUID(uid);
```

### 3️⃣ Utils 類

```javascript
// 格式化價格
Utils.formatPrice(50000);  // "$50,000"

// 格式化日期
Utils.formatDate('2026-04-21');  // "2026/04/21"

// 延遲
await Utils.delay(1000);  // 延遲 1 秒

// 防抖函數
const debouncedSearch = Utils.debounce(handleSearch, 300);

// 節流函數
const throttledScroll = Utils.throttle(handleScroll, 100);

// 複製到剪貼板
await Utils.copyToClipboard('text');

// 檢測是否在 LINE 內
Utils.isInLINE();

// 檢測設備類型
Utils.getDeviceType();  // 'mobile' | 'tablet' | 'desktop'

// 檢測是否移動設備
Utils.isMobile();

// 導出 CSV
Utils.exportCSV(data, 'filename.csv');

// 生成唯一 ID
Utils.generateID();

// 本地存儲
Utils.localStorage.set('key', value);
Utils.localStorage.get('key', defaultValue);
Utils.localStorage.remove('key');
```

---

## 🎯 針對 4 個快速修復的集成方案

### 修復 #3 (API 重試) - 最需要 js-utils.js

```javascript
// ❌ 不使用 js-utils 的舊方式
const fetchData = async () => {
  try {
    const res = await fetch(url);
    const data = await res.json();
    // ...
  } catch (e) {
    showToast('失敗', 'error');
  }
};

// ✅ 使用 js-utils 的新方式
const fetchData = async () => {
  try {
    const client = new APIClient(CONFIG.WORKER_URL, 8000);
    const data = await client.get('/api/itineraries');
    
    if (data.success) {
      setItineraries(data.data);
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    showToast(client.getErrorMessage(error), 'error');
  }
};
```

### 修復 #2 (表單驗證) - 強烈推薦使用 js-utils.js

```javascript
// ❌ 自己寫驗證函數
const validateItinerary = (data) => {
  const errors = [];
  if (!data.title) errors.push('標題為空');
  // ... 很多驗證代碼
  return { isValid: errors.length === 0, errors };
};

// ✅ 直接使用 js-utils
const validation = Validator.validateItinerary(draftData);
if (!validation.isValid) {
  validation.errors.forEach(err => showToast(err, 'error'));
}
```

---

## 🚀 推薦的集成方案

### 針對 TravelKeeper 項目的推薦配置

```
項目目錄/
├── index.html            (首頁，引入 js-utils.js)
├── login.html            (登入，引入 js-utils.js)
├── admin.html            (管理，引入 js-utils.js)
├── register.html         (註冊，引入 js-utils.js)
├── dashboard.html        (儀表板，引入 js-utils.js)
└── js-utils.js           (工具庫，放在根目錄)
```

### HTML 引入模板（所有文件都用這個）

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>應用名稱</title>
  <!-- 必要的库文件 -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.6/babel.min.js"></script>
  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
</head>
<body>
  <div id="root"></div>

  <!-- ✅ 關鍵：引入 js-utils.js -->
  <script src="js-utils.js"></script>

  <!-- 你的應用代碼 -->
  <script type="text/babel">
    // 現在可以使用 APIClient, Validator, Utils
    // ... 你的應用代碼
  </script>
</body>
</html>
```

---

## ✅ 集成檢查清單

- [ ] 下載 `js-utils.js` 文件
- [ ] 決定存放位置（根目錄或 js/ 文件夾）
- [ ] 在每個需要的 HTML 中添加 `<script src="js-utils.js"></script>`
- [ ] 測試：打開瀏覽器 F12，在 Console 中輸入 `new APIClient('test')`
- [ ] 應該看到沒有錯誤，說明引入成功
- [ ] 開始使用 APIClient, Validator, Utils 中的方法

---

## 🐛 常見集成問題

### Q1: "APIClient is not defined" 錯誤

**原因**: 
- js-utils.js 引入位置不對
- 引入順序不對（應在 React 代碼之前）

**解決**:
```html
<!-- ❌ 錯誤 -->
<script type="text/babel">
  const client = new APIClient(...); // APIClient 還未定義
</script>
<script src="js-utils.js"></script>

<!-- ✅ 正確 -->
<script src="js-utils.js"></script>
<script type="text/babel">
  const client = new APIClient(...); // 現在可以使用
</script>
```

### Q2: "Validator is not defined" 錯誤

**原因**: 同上

**解決**: 確保 `js-utils.js` 在 `<script type="text/babel">` 之前引入

### Q3: 路徑錯誤 (404)

**原因**: 文件路徑不正確

**解決**:
```html
<!-- 根目錄引入 -->
<script src="js-utils.js"></script>

<!-- 從 js 文件夾引入 -->
<script src="js/js-utils.js"></script>

<!-- 從子目錄返回父目錄 -->
<script src="../js-utils.js"></script>
```

### Q4: React 報錯 "Cannot read property of undefined"

**原因**: js-utils.js 在 React 和 Babel 之後引入

**解決**: 確保引入順序
```html
1. React CDN
2. ReactDOM CDN
3. Babel CDN
4. js-utils.js           ← 要在 Babel 之後
5. <script type="text/babel">
```

---

## 📞 驗證集成是否成功

### 方法 1: 使用開發者工具

```
1. 打開你的 HTML 文件
2. 按 F12 打開開發者工具
3. 進入 Console 標籤
4. 輸入: new APIClient('test')
5. 如果看到 APIClient {} 對象，說明成功
```

### 方法 2: 查看文件加載

```
1. F12 > Network 標籤
2. 刷新頁面
3. 查看是否有 js-utils.js 的請求
4. 狀態應該是 200 (成功)
```

### 方法 3: 測試實際功能

```javascript
// 在 Console 中測試
Utils.formatPrice(50000);
// 應該輸出: "$50,000"

Validator.validateItinerary({
  title: 'Test',
  price: 1000,
  days: 5,
  description: 'This is a test description for validation'
});
// 應該看到驗證結果
```

---

## 🎯 推薦的逐步集成流程

### 第 1 步：放置文件
```bash
# 將 js-utils.js 複製到項目根目錄
cp js-utils.js /path/to/your/project/
```

### 第 2 步：更新 index.html
```html
<script src="js-utils.js"></script>
```

### 第 3 步：更新 admin.html
```html
<script src="js-utils.js"></script>
```

### 第 4 步：更新 register.html
```html
<script src="js-utils.js"></script>
```

### 第 5 步：測試
```
打開每個文件，F12 測試是否可以使用 APIClient, Validator, Utils
```

### 第 6 步：重構代碼
```
逐步將自己寫的驗證、API 調用等代碼替換為 js-utils 中的方法
```

---

## ✨ 使用 js-utils.js 的好處

✅ **代碼復用** - 多個文件使用相同的邏輯  
✅ **一致性** - 所有文件用相同的方式處理 API 和驗證  
✅ **易於維護** - 修改一個地方，所有文件都受益  
✅ **更少重複** - 不需要在每個文件中重寫相同的代碼  
✅ **最佳實踐** - 遵循標準的錯誤處理和驗證模式  

---

**總結**: 

就把 `js-utils.js` 放在**項目根目錄**，然後在需要的 HTML 文件中用 `<script src="js-utils.js"></script>` 引入即可！
