import React from 'react';

interface BottomSectionProps {
  className?: string;
}

const BottomSection: React.FC<BottomSectionProps> = ({ className = '' }) => {
  return (
    <div className={`bottom-section ${className}`}>
      <a href="https://www.youtube.com/@Kimeraware" target="_blank" rel="noopener noreferrer">
        <img
          src="/logo_temp.png"
          alt="Kimeraware Logo"
          className="logo-img"
        />
      </a>
      <div className="coming-soon-text">Proximamente...</div>
    </div>
  );
};

export default BottomSection;