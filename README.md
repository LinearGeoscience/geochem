# Geochemistry Dashboard

A web application for geochemistry data visualization and analysis.

## Prerequisites

- Python 3.8+
- Node.js 18+

## Installation

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # On Windows
# source venv/bin/activate  # On macOS/Linux
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

## Running the Application

### Start the Backend

```bash
cd backend
venv\Scripts\activate  # On Windows
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`

### Start the Frontend

```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:5173`
