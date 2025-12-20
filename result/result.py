"""Module containing definitions for the result type.

It works like Rust's Result type.
"""

from dataclasses import dataclass
from typing import Generic, TypeVar

from loguru import logger


_T = TypeVar("_T")
_E = TypeVar("_E")


@dataclass(frozen=True)
class Ok(Generic[_T]):  # noqa: UP046
    value: _T

    def __repr__(self):
        return f"Ok({self.value!r})"


@dataclass(frozen=True)
class Error(Generic[_E]):  # noqa: UP046
    """失敗を表すクラス"""

    value: _E

    def __repr__(self):
        return f"Error({self.value!r})"


# type Result<'Success,'Failure> =
#   | Ok of 'Success
#   | Error of 'Failure
#
# に相当する。上記はF#の型定義で、これをPythonで表現している。
Result = Ok[_T] | Error[_E]


if __name__ == "__main__":

    def divide(a: float, b: float) -> Result[float, str]:
        if b == 0:
            return Error("Cannot divide by zero.")
        else:
            return Ok(a / b)

    # 実際に使ってみる
    r1 = divide(10, 2)
    r2 = divide(5, 0)

    logger.info(r1)  # Ok(5.0)
    logger.info(r2)  # Error(Cannot divide by zero.)

    # 値を取り出す例:
    # - if文で取り出す (非推奨)
    if isinstance(r1, Ok):
        logger.info(f"Success: {r1.value}")  # 5.0
    elif isinstance(r1, Error):
        logger.error(f"Failure: {r1.value}")

    # - matchで取り出す (推奨)
    match r2:
        case Ok(value):
            logger.info(f"Success: {value}")
        case Error(value):
            logger.error(f"Failure: {value}")  # Cannot divide by zero.

    # 複数の値を返す例:
    @dataclass
    class MultiValues:
        message: str
        product: int

    def multi_return_dataclass(x: int, y: int) -> Result[MultiValues, str]:
        if x < 0 or y < 0:
            return Error("Negative input!")
        return Ok(MultiValues(message=f"Value of x+y is {x + y}", product=x * y))

    result = multi_return_dataclass(3, 4)
    match result:
        case Ok(values):
            logger.info(f"Success: {values.message}")
            logger.info(f"Product: {values.product}")
        case Error(msg):
            logger.error(f"Failure: {msg}")
