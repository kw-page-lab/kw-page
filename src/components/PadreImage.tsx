import React from 'react';
import padreImage from '../assets/padre_transparente.png';

interface PadreImageProps {
  className?: string;
}

const PadreImage: React.FC<PadreImageProps> = ({ className = '' }) => {
  return (
    <img
      src={padreImage}
      alt="Padre"
      className={`padre-img ${className}`}
    />
  );
};

export default PadreImage;