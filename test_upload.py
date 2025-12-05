import requests
import pandas as pd
import io

# Create a dummy CSV
df = pd.DataFrame({'A': [1, 2, 3], 'B': [4, 5, 6]})
csv_buffer = io.StringIO()
df.to_csv(csv_buffer, index=False)
csv_content = csv_buffer.getvalue()

# Create a dummy Excel
excel_buffer = io.BytesIO()
df.to_excel(excel_buffer, index=False)
excel_content = excel_buffer.getvalue()

url = "http://localhost:8000/api/data/upload"

print("Testing CSV Upload...")
files = {'file': ('test.csv', csv_content, 'text/csv')}
try:
    r = requests.post(url, files=files)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
except Exception as e:
    print(f"CSV Upload failed: {e}")

print("\nTesting Excel Upload...")
files = {'file': ('test.xlsx', excel_content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
try:
    r = requests.post(url, files=files)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
except Exception as e:
    print(f"Excel Upload failed: {e}")
