import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * ดักจับ error ที่ทำให้หน้าจอขาวเปล่า -> แสดงข้อความ + ปุ่มแทน
 * (React ไม่มี error boundary แบบ hook จึงต้องเป็น class component)
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    // log ไว้ดูใน console (ช่วย debug)
    console.error('UI crash caught by ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">เกิดข้อผิดพลาดในการแสดงผล</h2>
            <p className="text-sm text-gray-500 mb-5">
              หน้านี้ทำงานผิดพลาด (ไม่ใช่ข้อมูลสูญหาย) — ลองโหลดหน้าใหม่ หากยังเป็นซ้ำ แจ้งผู้ดูแลระบบ
            </p>
            <pre className="text-xs text-left text-rose-600 bg-rose-50 rounded-lg p-3 mb-5 overflow-x-auto max-h-32">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => { this.setState({ error: null }); window.location.reload() }}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                โหลดหน้าใหม่
              </button>
              <button
                onClick={() => { this.setState({ error: null }); window.location.href = '/' }}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
              >
                กลับหน้าแรก
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
