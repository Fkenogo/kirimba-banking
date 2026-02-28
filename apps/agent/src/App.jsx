import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";

const BASE_PATH = "/agent";

export default function App() {
  return (
    <Routes>
      <Route path={BASE_PATH} element={<HomePage />} />
      <Route path="*" element={<Navigate to={BASE_PATH} replace />} />
    </Routes>
  );
}
