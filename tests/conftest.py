"""
Pytest configuration and fixtures for all tests.

This file is automatically loaded by pytest and makes project root
modules importable in tests.
"""


import sys
from pathlib import Path


# Add project root to Python path so tests can import project modules
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))
