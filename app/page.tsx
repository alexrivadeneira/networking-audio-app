export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-50 text-slate-900">
      <div className="w-full max-w-md bg-white p-6 rounded-2xl shadow-sm border border-slate-100 text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-2">Network Notes AI</h1>
        <p className="text-sm text-slate-500 mb-8">
          Step aside after a conversation, dictate your notes, and let AI organize the rest.
        </p>
        
        {/* We will build our recording button component right here next */}
        <div className="flex justify-center my-6">
          <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center cursor-pointer hover:bg-red-200 transition-colors">
            <span className="text-red-600 font-semibold text-sm">Record</span>
          </div>
        </div>
      </div>
    </main>
  );
}