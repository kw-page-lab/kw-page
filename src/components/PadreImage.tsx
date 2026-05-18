import React from 'react';

interface PadreImageProps {
  className?: string;
}

const PadreImage: React.FC<PadreImageProps> = ({ className = '' }) => {
  return (
    <img
      src="/padre_transparente.png"
      alt="Padre"
      className={`padre-img ${className}`}
    />
  );
};

export default PadreImage;