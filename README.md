# Ghid de Instalare ADER App

O aplicație React Native cu backend Python pentru analiza viilor. Deocamdata este implementata partea doar de K-means.

## Cerințe Prealabile

Înainte de a începe, asigurăti-va că aveti următoarele instalate pe sistem:

- **Node.js** (v14 sau mai mare) - [Descarcă aici](https://nodejs.org/)
- **npm** sau **yarn** package manager
- **Python** (v3.8 sau mai mare) - [Descarcă aici](https://www.python.org/)
- **pip** (Python package manager)
- **React Native CLI** - Instalează global: `npm install -g react-native-cli`
- **Expo CLI** (dacă folosești Expo) - Instalează global: `npm install -g expo-cli`
- **Android Studio** (pentru dezvoltare Android) sau **Xcode** (pentru dezvoltare iOS pe macOS)

---

## 🚀 Începem

### Pasul 1: Clonează Repository-ul

```bash
git clone https://github.com/PrahoLama/ADER_App.git
cd ADER_App
```

---

## 🔧 Configurarea Backend-ului

### Pasul 2: Navighează în Directorul Backend

```bash
cd backend
```

### Pasul 3: Instalează Dependențele Python

```bash
pip install -r requirements.txt
```

**Alternativ folosind mediu virtual (Recomandat):**

```bash
# Creează mediu virtual
python -m venv venv

# Activează mediul virtual
# Pe Windows:
venv\Scripts\activate
# Pe macOS/Linux:
source venv/bin/activate

# Instalează dependențele
pip install -r requirements.txt
```

### Pasul 4: Configurează Setările Backend-ului

Dacă există un fișier de configurare (ex: `config.py` sau `.env`), actualizează-l cu setările tale:
- Conexiuni la bază de date
- Chei API
- Setări port (implicit este de obicei 5000 sau 8000)

### Pasul 5: Pornește Serverul Backend

```bash
# Pentru server Flask
python server.js

# Sau dacă folosești Python direct
python vine.py
# sau
python vine_analysis.py
```

Backend-ul ar trebui să ruleze acum (de obicei pe `http://localhost:5000` sau `http://localhost:8000`).

**Lasă această fereastră de terminal deschisă** și serverul să ruleze.

---

## 📱 Configurarea Frontend-ului

### Pasul 6: Deschide un Terminal Nou și Navighează în Directorul Frontend

```bash
cd frontend
```

### Pasul 7: Instalează Dependențele Node

```bash
npm install
```

**Sau folosind yarn:**

```bash
yarn install
```

### Pasul 8: Configurează Endpoint-ul API

Actualizează endpoint-ul API în codul frontend pentru a indica către serverul tău backend:

1. Caută un fișier constants (probabil în `frontend/constants/`)
2. Actualizează URL-ul de bază pentru a se potrivi cu serverul tău backend:
   ```javascript
   const API_BASE_URL = 'http://localhost:5000'; // sau URL-ul backend-ului tău
   ```

### Pasul 9: Pornește Aplicația Frontend

**Dacă folosești Expo:**

```bash
npx expo start
# sau
npm start
```

**Dacă folosești React Native CLI:**

```bash
# Pentru iOS (doar macOS)
npx react-native run-ios

# Pentru Android
npx react-native run-android
```

### Pasul 10: Rulează Aplicația

- **Expo**: Scanează codul QR cu aplicația Expo Go pe telefon, sau apasă `a` pentru emulatorul Android sau `i` pentru simulatorul iOS
- **React Native CLI**: Aplicația ar trebui să se deschidă automat în emulatorul/simulatorul tău

---

## 📂 Structura Proiectului

```
ADER_App/
├── backend/
│   ├── .expo/
│   ├── node_modules/
│   ├── uploads/
│   ├── vineyard_analysis_results/
│   ├── package.json
│   ├── package-lock.json
│   ├── requirements.txt
│   ├── server.js
│   ├── vine.py
│   └── vine_analysis.py
│
└── frontend/
    ├── .expo/
    ├── node_modules/
    ├── components/
    ├── constants/
    ├── App.js
    ├── app.json
    ├── package.json
    ├── package-lock.json
    └── requirements.txt
```

---

## 🐛 Rezolvarea Problemelor

### Probleme Backend

**Portul este deja folosit:**
```bash
# Găsește și oprește procesul care folosește portul
# Pe Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Pe macOS/Linux:
lsof -ti:5000 | xargs kill -9
```

**Erori de modul negăsit:**
```bash
pip install --upgrade -r requirements.txt
```

### Probleme Frontend

**Probleme cu Metro bundler:**
```bash
# Șterge cache-ul și repornește
npx react-native start --reset-cache
```

**Probleme cu node modules:**
```bash
# Instalare curată
rm -rf node_modules
npm install
```

**Probleme build iOS (macOS):**
```bash
cd ios
pod install
cd ..
npx react-native run-ios
```

---

## 🔑 Comenzi Comune

### Backend
```bash
# Pornește serverul
python server.js

# Rulează scriptul de analiză
python vine_analysis.py
```

### Frontend
```bash
# Pornește serverul de dezvoltare
npm start

# Rulează pe Android
npx react-native run-android

# Rulează pe iOS (doar macOS)
npx react-native run-ios

# Șterge cache-ul
npm start -- --reset-cache
```

---

**Programare plăcută! 🚀**
