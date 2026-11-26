using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventSync.Api.Migrations
{
    /// <inheritdoc />
    public partial class RenameChurchEventType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 9,
                column: "Name",
                value: "Church Events");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 9,
                column: "Name",
                value: "Church Anniversary");
        }
    }
}
