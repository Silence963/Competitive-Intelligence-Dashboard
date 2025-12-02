/* eslint-disable jsx-a11y/anchor-is-valid */
import React from 'react';
import '../styles/components.css';
import { FaFacebookF, FaTwitter, FaInstagram, FaLinkedinIn } from 'react-icons/fa';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-logo">Social Media & SWOT Analysis</div>
        <div className="footer-socials">
          <a href="#"><FaFacebookF /></a>
          <a href="#"><FaTwitter /></a>
          <a href="#"><FaInstagram /></a>
          <a href="#"><FaLinkedinIn /></a>
        </div>
      </div>
      <div className="footer-bottom">
        &copy; {new Date().getFullYear()} Social Media & SWOT Analysis. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
