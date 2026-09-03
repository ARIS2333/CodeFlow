import { useState } from 'react';
import { systemPrompt_HandlePractice } from './config/systemPrompt_HandlePractice';
import { requestStructured } from './lib/llmClient';
import { validateProblemDetails, type ProblemDetails } from './lib/llmSchemas';

interface UploadPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (content: string, problemDetails: ProblemDetails | null, error: string | null) => void;
  onApiProcessingChange: (isProcessing: boolean) => void;
}

const UploadPopup: React.FC<UploadPopupProps> = ({ isOpen, onClose, onUpload, onApiProcessingChange }) => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); // Local state to track submission

  if (!isOpen) return null;

  const handleSubmit = async () => {
    // Prevent submission if already submitting
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    // Inform parent that API processing has started
    onApiProcessingChange(true);
    
    try {
      const problemDetails = await requestStructured({
        systemPrompt: systemPrompt_HandlePractice,
        message: content,
        validate: validateProblemDetails,
        label: 'practice problem'
      });

      // Pass content and validated response to parent
      onUpload(content, problemDetails, null);
    } catch (error: unknown) {
      console.error('API Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      // Pass content and error to parent
      onUpload(content, null, errorMessage);
    } finally {
      // Inform parent that API processing has completed
      onApiProcessingChange(false);
      setIsSubmitting(false);
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b p-4">
          <h3 className="text-lg font-semibold text-gray-900">Upload Practice Problem</h3>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={isSubmitting}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-4">
          <textarea
            className="w-full h-40 p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your practice problem content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
        
        <div className="flex justify-end space-x-2 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !content.trim()}
            className={`px-4 py-2 rounded-md text-white ${
              isSubmitting || !content.trim() 
                ? 'bg-blue-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSubmitting ? 'Processing...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadPopup;