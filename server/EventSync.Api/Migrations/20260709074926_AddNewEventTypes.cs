using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace EventSync.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNewEventTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 1,
                column: "Icon",
                value: "📖");

            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 7,
                column: "Icon",
                value: "🏢");

            migrationBuilder.InsertData(
                table: "EventTypes",
                columns: new[] { "Id", "Icon", "Name" },
                values: new object[,]
                {
                    { 10, "🏖️", "Swimming Vacation" },
                    { 11, "👨‍👩‍👧‍👦", "Family Reunion" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 10);

            migrationBuilder.DeleteData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 11);

            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 1,
                column: "Icon",
                value: "🎓");

            migrationBuilder.UpdateData(
                table: "EventTypes",
                keyColumn: "Id",
                keyValue: 7,
                column: "Icon",
                value: "🎤");
        }
    }
}
